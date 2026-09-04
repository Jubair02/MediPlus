import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'crypto'
import { promisify } from 'util'
import { db } from '@/lib/db'
import type { Role } from '@/lib/types'
import { STAFF_ROLES } from '@/lib/rbac'

/**
 * Signing key for session tokens. There is deliberately no fallback: a default here
 * would be committed to the repository, and anyone who could read it could forge a
 * token for any user id and any role — defeating every guard below. Failing at import
 * is the safe outcome, because the alternative is a deploy that looks healthy and is
 * silently unauthenticated.
 *
 * Generate a value with 32 bytes of randomness, hex-encoded.
 */
function requireJwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET is not set. Add a 32-byte random hex value to .env (local) or the deployment environment.')
  }
  return secret
}

const JWT_SECRET = requireJwtSecret()

export interface JwtPayload {
  sub: string
  email: string
  role: string
  iat: number
  exp: number
}

/**
 * scrypt, off the main thread.
 *
 * The synchronous `scryptSync` runs its whole key-derivation on the event loop, so a
 * burst of login attempts stops the server answering anything at all — the password
 * check becomes a denial-of-service lever as well as a credential-stuffing target.
 * The async form hands the work to libuv's threadpool instead, so concurrent requests
 * interleave. Rate limiting still matters (the pool is only UV_THREADPOOL_SIZE wide);
 * see `src/lib/ratelimit.ts`.
 */
const scryptAsync = promisify(scrypt) as (password: string, salt: string, keylen: number) => Promise<Buffer>

/** Cost of one derivation. 64 bytes of scrypt output at Node's default N=16384. */
const KEY_LENGTH = 64

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const hash = (await scryptAsync(password, salt, KEY_LENGTH)).toString('hex')
  return `${salt}:${hash}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [salt, hash] = stored.split(':')
    const hashBuf = Buffer.from(hash, 'hex')
    const testBuf = await scryptAsync(password, salt, KEY_LENGTH)
    // Length-mismatched buffers make timingSafeEqual throw, which the catch turns
    // into a plain "wrong password" — the right answer for a malformed stored hash.
    return hashBuf.length === testBuf.length && timingSafeEqual(hashBuf, testBuf)
  } catch {
    return false
  }
}

export function signJwt(payload: { sub: string; email: string; role: string }, expiresInSeconds = 60 * 60 * 24 * 7): string {
  const header = { alg: 'HS256', typ: 'JWT' }
  const body = { ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + expiresInSeconds }
  const h = Buffer.from(JSON.stringify(header)).toString('base64url')
  const p = Buffer.from(JSON.stringify(body)).toString('base64url')
  const sig = createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url')
  return `${h}.${p}.${sig}`
}

export function verifyJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const [h, p, sig] = parts
    const expected = createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url')
    if (sig !== expected) return null
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString()) as JwtPayload
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

export interface AuthUser {
  id: string
  name: string | null
  email: string
  phone: string | null
  role: Role
  status: string
}

/** Extract and verify the Bearer token, then load the live user from DB. */
export async function getAuthUser(request: Request): Promise<AuthUser | null> {
  const authHeader = request.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return null
  const payload = verifyJwt(token)
  if (!payload) return null
  const user = await db.user.findUnique({ where: { id: payload.sub } })
  if (!user || user.status !== 'ACTIVE') return null
  return { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role as Role, status: user.status }
}

export function unauthorized(message = 'Unauthorized') {
  return Response.json({ error: message }, { status: 401 })
}

export function forbidden(message = 'Forbidden') {
  return Response.json({ error: message }, { status: 403 })
}

/** 429 with a Retry-After header, so clients (and crawlers) can back off correctly. */
export function tooManyRequests(message: string, retryAfterSeconds: number) {
  return Response.json(
    { error: message },
    { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))) } }
  )
}

export function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 })
}

export function notFound(message = 'Not found') {
  return Response.json({ error: message }, { status: 404 })
}

export function serverError(e: unknown) {
  console.error('[api-error]', e)
  const message = e instanceof Error ? e.message : 'Internal server error'
  return Response.json({ error: message }, { status: 500 })
}

// ---------- role guards ----------
// Every guard returns `AuthUser | Response`. Call sites MUST narrow with
// `if (x instanceof Response) return x` before touching the user.

/** Guard: require one of the given roles. */
export async function requireRole(request: Request, roles: readonly Role[]): Promise<AuthUser | Response> {
  const user = await getAuthUser(request)
  if (!user) return unauthorized()
  if (!roles.includes(user.role)) return forbidden(`Requires role: ${roles.join(' or ')}`)
  return user
}

/** Guard: require any signed-in user, whatever the role (profile, notifications). */
export async function requireAuth(request: Request): Promise<AuthUser | Response> {
  const user = await getAuthUser(request)
  if (!user) return unauthorized()
  return user
}

/**
 * Guard: CUSTOMER only.
 *
 * Shopping — cart, wishlist, addresses, checkout, orders, prescriptions, reviews, Q&A —
 * is a customer capability. Staff accounts operate the store through their own
 * /api/{admin,pharmacist,delivery} resources and must never transact as a shopper,
 * so they get 403 here rather than a self-scoped success.
 */
export async function requireCustomer(request: Request): Promise<AuthUser | Response> {
  const user = await getAuthUser(request)
  if (!user) return unauthorized()
  if (user.role !== 'CUSTOMER') {
    return forbidden('This action is only available to customer accounts')
  }
  return user
}

/** Guard: any staff role (ADMIN | PHARMACIST | DELIVERY). */
export async function requireStaff(request: Request): Promise<AuthUser | Response> {
  return requireRole(request, STAFF_ROLES)
}
