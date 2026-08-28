import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { db } from '@/lib/db'

const JWT_SECRET = process.env.JWT_SECRET || 'medplus-epharm-dev-secret'

export interface JwtPayload {
  sub: string
  email: string
  role: string
  iat: number
  exp: number
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [salt, hash] = stored.split(':')
    const hashBuf = Buffer.from(hash, 'hex')
    const testBuf = scryptSync(password, salt, 64)
    return timingSafeEqual(hashBuf, testBuf)
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
  role: string
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
  return { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role, status: user.status }
}

export function unauthorized(message = 'Unauthorized') {
  return Response.json({ error: message }, { status: 401 })
}

export function forbidden(message = 'Forbidden') {
  return Response.json({ error: message }, { status: 403 })
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

/** Guard: require one of the given roles */
export async function requireRole(request: Request, roles: string[]): Promise<AuthUser | Response> {
  const user = await getAuthUser(request)
  if (!user) return unauthorized()
  if (!roles.includes(user.role)) return forbidden(`Requires role: ${roles.join(' or ')}`)
  return user
}
