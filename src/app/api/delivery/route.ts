import { db } from '@/lib/db'
import { requireRole, badRequest, notFound, serverError } from '@/lib/auth'
import { readJson, optStr, orderInclude, parseOrder, notify } from '../_lib'

const DELIVERY_STATUSES = ['OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED']

/** Allowed transitions from the delivery staff perspective */
function canTransition(from: string, to: string): boolean {
  if (from === 'PROCESSING') return DELIVERY_STATUSES.includes(to)
  if (from === 'OUT_FOR_DELIVERY') return to === 'DELIVERED' || to === 'FAILED'
  return false
}

/** GET /api/delivery → {active, history} — my assigned orders */
export async function GET(request: Request) {
  try {
    const user = await requireRole(request, ['DELIVERY'])
    if (user instanceof Response) return user
    const [activeRaw, historyRaw] = await Promise.all([
      db.order.findMany({
        where: { deliveryStaffId: user.id, status: { in: ['PROCESSING', 'OUT_FOR_DELIVERY'] } },
        include: orderInclude,
        orderBy: { createdAt: 'desc' },
      }),
      db.order.findMany({
        where: { deliveryStaffId: user.id, status: { in: ['DELIVERED', 'FAILED'] } },
        include: orderInclude,
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
    ])
    return Response.json({
      active: activeRaw.map((o) => parseOrder(o)),
      history: historyRaw.map((o) => parseOrder(o)),
    })
  } catch (e) {
    return serverError(e)
  }
}

/** PUT /api/delivery {orderId, status:'OUT_FOR_DELIVERY'|'DELIVERED'|'FAILED', note?} */
export async function PUT(request: Request) {
  try {
    const user = await requireRole(request, ['DELIVERY'])
    if (user instanceof Response) return user
    const body = await readJson(request)
    if (!body) return badRequest('Invalid request body')
    const orderId = optStr(body.orderId)
    if (!orderId) return badRequest('Order id is required')
    const status = optStr(body.status)
    if (!status || !DELIVERY_STATUSES.includes(status)) return badRequest('Invalid status')

    const order = await db.order.findFirst({ where: { id: orderId, deliveryStaffId: user.id }, include: orderInclude })
    if (!order) return notFound('Order not found')
    if (!canTransition(order.status, status)) {
      return badRequest(`Cannot change order from ${order.status} to ${status}`)
    }

    const note = optStr(body.note)?.trim()
    const isDelivered = status === 'DELIVERED'
    const markPaid = isDelivered && order.paymentMethod === 'COD'

    await db.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: {
          status,
          statusNote: note || 'Updated by delivery staff',
          ...(markPaid ? { paymentStatus: 'PAID' } : {}),
        },
      })
      if (markPaid && order.payment) {
        await tx.payment.update({ where: { id: order.payment.id }, data: { status: 'PAID' } })
      }
      const title = status === 'OUT_FOR_DELIVERY' ? 'Out for delivery' : status === 'DELIVERED' ? 'Order delivered' : 'Delivery failed'
      const message =
        status === 'OUT_FOR_DELIVERY'
          ? `Order ${order.orderNo} is out for delivery.`
          : status === 'DELIVERED'
            ? `Order ${order.orderNo} has been delivered.`
            : `Delivery attempt for order ${order.orderNo} failed.${note ? ` Note: ${note}` : ''}`
      await tx.notification.create({ data: { userId: order.userId, title, message } })
    })

    const full = await db.order.findUnique({ where: { id: order.id }, include: orderInclude })
    if (!full) return notFound('Order not found')
    return Response.json({ order: parseOrder(full) })
  } catch (e) {
    return serverError(e)
  }
}
