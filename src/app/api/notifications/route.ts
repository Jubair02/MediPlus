import { db } from '@/lib/db'
import { requireAuth, badRequest, serverError } from '@/lib/auth'
import { readJson } from '../_lib'

/** GET /api/notifications (Bearer) → latest 30 + unread count */
export async function GET(request: Request) {
  try {
    const user = await requireAuth(request)
    if (user instanceof Response) return user
    const [notifications, unread] = await Promise.all([
      db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 30 }),
      db.notification.count({ where: { userId: user.id, read: false } }),
    ])
    return Response.json({ notifications, unread })
  } catch (e) {
    return serverError(e)
  }
}

/** PUT /api/notifications {action:'read-all'} */
export async function PUT(request: Request) {
  try {
    const user = await requireAuth(request)
    if (user instanceof Response) return user
    const body = await readJson(request)
    if (!body || body.action !== 'read-all') return badRequest('Invalid action')
    await db.notification.updateMany({ where: { userId: user.id, read: false }, data: { read: true } })
    return Response.json({ ok: true })
  } catch (e) {
    return serverError(e)
  }
}
