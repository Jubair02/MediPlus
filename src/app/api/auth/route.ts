import { db } from '@/lib/db'
import {
  getAuthUser,
  unauthorized,
  badRequest,
  forbidden,
  serverError,
  tooManyRequests,
  hashPassword,
  verifyPassword,
  signJwt,
} from '@/lib/auth'
import { clearFailures, clientKey, consume, isLockedOut, recordFailure } from '@/lib/ratelimit'
import { readJson, publicUser, optStr } from '../_lib'

const EMAIL_RE = /^\S+@\S+\.\S+$/

// ---------- brute-force limits ----------
//
// Two independent guards, because either one alone leaves a hole:
//   • the per-IP budget stops one client hammering the endpoint, but an attacker with
//     a proxy pool (or a spoofed X-Forwarded-For) simply changes address;
//   • the per-account lockout stops that spread-out grind, but cannot on its own stop
//     someone spending the server's CPU on scrypt against addresses that do not exist.
// Both counters are process-local (src/lib/ratelimit.ts) — a multi-instance deploy
// needs to move them to a shared store before this is a real defence.
// Generous, because a request that reaches the app with no forwarded address falls into a
// single shared bucket (see clientKey) — a tight cap there would throttle unrelated users.
const LOGIN_IP_LIMIT = 30
const LOGIN_IP_WINDOW_MS = 5 * 60 * 1000
/** Consecutive failures for one email before that account stops answering. */
const LOGIN_LOCKOUT_LIMIT = 5
const LOGIN_LOCKOUT_WINDOW_MS = 15 * 60 * 1000
/** Registration hashes a password too, so it needs its own (looser) budget. */
const REGISTER_IP_LIMIT = 10
const REGISTER_IP_WINDOW_MS = 60 * 60 * 1000

const LOCKED_OUT_MESSAGE = 'Too many failed sign-in attempts for this account. Please try again later.'
const THROTTLED_MESSAGE = 'Too many attempts. Please wait a moment and try again.'

/** POST /api/auth {action:'register'|'login', ...} */
export async function POST(request: Request) {
  try {
    const body = await readJson(request)
    if (!body) return badRequest('Invalid request body')
    const action = optStr(body.action)

    const ip = clientKey(request)

    if (action === 'register') {
      const budget = consume(`register:${ip}`, REGISTER_IP_LIMIT, REGISTER_IP_WINDOW_MS)
      if (!budget.ok) return tooManyRequests(THROTTLED_MESSAGE, budget.retryAfter)
      const name = optStr(body.name)?.trim()
      const email = optStr(body.email)?.trim().toLowerCase()
      const password = optStr(body.password)
      const phone = optStr(body.phone)?.trim()
      if (!name) return badRequest('Name is required')
      if (!email || !EMAIL_RE.test(email)) return badRequest('Please enter a valid email')
      if (!password || password.length < 6) return badRequest('Password must be at least 6 characters')
      const existing = await db.user.findUnique({ where: { email } })
      if (existing) return badRequest('An account with this email already exists')
      const user = await db.user.create({
        data: { name, email, password: await hashPassword(password), phone: phone || null, role: 'CUSTOMER', status: 'ACTIVE' },
      })
      const token = signJwt({ sub: user.id, email: user.email, role: user.role })
      return Response.json({ token, user: publicUser(user) }, { status: 201 })
    }

    if (action === 'login') {
      // The IP budget is spent before anything else, so a flood costs one map lookup
      // rather than a database round-trip and a key derivation.
      const budget = consume(`login:${ip}`, LOGIN_IP_LIMIT, LOGIN_IP_WINDOW_MS)
      if (!budget.ok) return tooManyRequests(THROTTLED_MESSAGE, budget.retryAfter)

      const email = optStr(body.email)?.trim().toLowerCase()
      const password = optStr(body.password)
      if (!email || !password) return badRequest('Email and password are required')

      const lockKey = `login-fail:${email}`
      const locked = isLockedOut(lockKey, LOGIN_LOCKOUT_LIMIT, LOGIN_LOCKOUT_WINDOW_MS)
      if (!locked.ok) return tooManyRequests(LOCKED_OUT_MESSAGE, locked.retryAfter)

      const user = await db.user.findUnique({ where: { email } })
      if (!user || !user.password || !(await verifyPassword(password, user.password))) {
        // Counted per email rather than per IP: this is what makes a slow, distributed
        // grind against one account run out of attempts.
        recordFailure(lockKey, LOGIN_LOCKOUT_WINDOW_MS)
        return unauthorized('Invalid email or password')
      }
      if (user.status !== 'ACTIVE') return forbidden('Account is deactivated')
      clearFailures(lockKey)
      const token = signJwt({ sub: user.id, email: user.email, role: user.role })
      return Response.json({ token, user: publicUser(user) })
    }

    return badRequest('Invalid action')
  } catch (e) {
    return serverError(e)
  }
}

/** GET /api/auth (Bearer) → current user */
export async function GET(request: Request) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const dbUser = await db.user.findUnique({ where: { id: user.id } })
    if (!dbUser) return unauthorized()
    return Response.json({ user: publicUser(dbUser) })
  } catch (e) {
    return serverError(e)
  }
}

/** PUT /api/auth (Bearer) {name?, phone?, currentPassword?, newPassword?} */
export async function PUT(request: Request) {
  try {
    const auth = await getAuthUser(request)
    if (!auth) return unauthorized()
    const body = await readJson(request)
    if (!body) return badRequest('Invalid request body')

    const data: { name?: string; phone?: string | null; password?: string } = {}
    const name = optStr(body.name)?.trim()
    if (name) data.name = name
    if (body.phone !== undefined) data.phone = optStr(body.phone)?.trim() || null

    const newPassword = optStr(body.newPassword)
    if (newPassword) {
      if (newPassword.length < 6) return badRequest('New password must be at least 6 characters')
      const currentPassword = optStr(body.currentPassword)
      if (!currentPassword) return badRequest('Current password is required')
      const dbUser = await db.user.findUnique({ where: { id: auth.id } })
      if (!dbUser || !dbUser.password || !(await verifyPassword(currentPassword, dbUser.password))) {
        return badRequest('Current password is incorrect')
      }
      data.password = await hashPassword(newPassword)
    }

    if (Object.keys(data).length === 0) return badRequest('Nothing to update')
    const updated = await db.user.update({ where: { id: auth.id }, data })
    return Response.json({ user: publicUser(updated) })
  } catch (e) {
    return serverError(e)
  }
}
