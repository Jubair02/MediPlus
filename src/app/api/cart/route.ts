import { db } from '@/lib/db'
import { getAuthUser, unauthorized, badRequest, notFound, serverError } from '@/lib/auth'
import { readJson, numOr } from '../_lib'

async function loadCart(userId: string) {
  return db.cartItem.findMany({
    where: { userId },
    include: { medicine: { include: { category: true } } },
    orderBy: { createdAt: 'desc' },
  })
}

/** GET /api/cart (Bearer) → my cart items (newest first) */
export async function GET(request: Request) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const items = await loadCart(user.id)
    return Response.json({ items })
  } catch (e) {
    return serverError(e)
  }
}

/** POST /api/cart {medicineId, quantity=1} — add to cart (clamped to stock) */
export async function POST(request: Request) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const body = await readJson(request)
    if (!body) return badRequest('Invalid request body')
    const medicineId = typeof body.medicineId === 'string' ? body.medicineId : ''
    if (!medicineId) return badRequest('Medicine id is required')

    const medicine = await db.medicine.findUnique({ where: { id: medicineId } })
    if (!medicine || medicine.status !== 'ACTIVE') return notFound('Medicine not available')
    if (medicine.stock <= 0) return badRequest('Out of stock')

    const requested = Math.max(1, Math.trunc(numOr(body.quantity, 1)))
    const existing = await db.cartItem.findUnique({
      where: { userId_medicineId: { userId: user.id, medicineId } },
    })
    const quantity = Math.min((existing?.quantity ?? 0) + requested, medicine.stock)
    await db.cartItem.upsert({
      where: { userId_medicineId: { userId: user.id, medicineId } },
      update: { quantity },
      create: { userId: user.id, medicineId, quantity },
    })
    const items = await loadCart(user.id)
    return Response.json({ items })
  } catch (e) {
    return serverError(e)
  }
}

/** PUT /api/cart {itemId, quantity} — set quantity clamped 1..stock */
export async function PUT(request: Request) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const body = await readJson(request)
    if (!body) return badRequest('Invalid request body')
    const itemId = typeof body.itemId === 'string' ? body.itemId : ''
    if (!itemId) return badRequest('Item id is required')

    const item = await db.cartItem.findFirst({ where: { id: itemId, userId: user.id }, include: { medicine: true } })
    if (!item) return notFound('Cart item not found')
    if (item.medicine.status !== 'ACTIVE') return badRequest('Medicine is no longer available')
    if (item.medicine.stock <= 0) return badRequest('Out of stock')

    const requested = Math.trunc(numOr(body.quantity, 1))
    const quantity = Math.max(1, Math.min(Number.isFinite(requested) ? requested : 1, item.medicine.stock))
    await db.cartItem.update({ where: { id: itemId }, data: { quantity } })
    const items = await loadCart(user.id)
    return Response.json({ items })
  } catch (e) {
    return serverError(e)
  }
}

/** DELETE /api/cart?itemId= (remove one) or DELETE /api/cart (clear cart) */
export async function DELETE(request: Request) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const itemId = new URL(request.url).searchParams.get('itemId')
    if (itemId) {
      const item = await db.cartItem.findFirst({ where: { id: itemId, userId: user.id } })
      if (!item) return notFound('Cart item not found')
      await db.cartItem.delete({ where: { id: itemId } })
    } else {
      await db.cartItem.deleteMany({ where: { userId: user.id } })
    }
    const items = await loadCart(user.id)
    return Response.json({ items })
  } catch (e) {
    return serverError(e)
  }
}
