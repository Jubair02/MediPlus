import { db } from '@/lib/db'
import { getAuthUser, unauthorized, badRequest, forbidden, serverError, hashPassword, verifyPassword, signJwt } from '@/lib/auth'
import { readJson, publicUser, optStr } from '../_lib'

const EMAIL_RE = /^\S+@\S+\.\S+$/

/** POST /api/auth {action:'register'|'login', ...} */
export async function POST(request: Request) {
  try {
    const body = await readJson(request)
    if (!body) return badRequest('Invalid request body')
    const action = optStr(body.action)

    if (action === 'register') {
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
        data: { name, email, password: hashPassword(password), phone: phone || null, role: 'CUSTOMER', status: 'ACTIVE' },
      })
      const token = signJwt({ sub: user.id, email: user.email, role: user.role })
      return Response.json({ token, user: publicUser(user) }, { status: 201 })
    }

    if (action === 'login') {
      const email = optStr(body.email)?.trim().toLowerCase()
      const password = optStr(body.password)
      if (!email || !password) return badRequest('Email and password are required')
      const user = await db.user.findUnique({ where: { email } })
      if (!user || !user.password || !verifyPassword(password, user.password)) {
        return unauthorized('Invalid email or password')
      }
      if (user.status !== 'ACTIVE') return forbidden('Account is deactivated')
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
      if (!dbUser || !dbUser.password || !verifyPassword(currentPassword, dbUser.password)) {
        return badRequest('Current password is incorrect')
      }
      data.password = hashPassword(newPassword)
    }

    if (Object.keys(data).length === 0) return badRequest('Nothing to update')
    const updated = await db.user.update({ where: { id: auth.id }, data })
    return Response.json({ user: publicUser(updated) })
  } catch (e) {
    return serverError(e)
  }
}
