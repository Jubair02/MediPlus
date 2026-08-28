import { db } from '@/lib/db'
import { getAuthUser, unauthorized, badRequest, serverError } from '@/lib/auth'

/** GET /api/wishlist → { items: WishlistItem[], ids: string[] } */
export async function GET(request: Request) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const items = await db.wishlistItem.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      include: {
        medicine: { include: { category: true } },
      },
    })
    return Response.json({
      items: items.filter((i) => i.medicine.status === 'ACTIVE'),
      ids: items.map((i) => i.medicineId),
    })
  } catch (e) {
    return serverError(e)
  }
}

/** POST /api/wishlist { medicineId } → toggle → { ids, added } */
export async function POST(request: Request) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const body = await request.json().catch(() => null)
    const medicineId = (body as { medicineId?: string } | null)?.medicineId
    if (!medicineId) return badRequest('medicineId is required')

    const medicine = await db.medicine.findUnique({ where: { id: medicineId } })
    if (!medicine || medicine.status !== 'ACTIVE') return badRequest('Medicine not available')

    const existing = await db.wishlistItem.findUnique({
      where: { userId_medicineId: { userId: user.id, medicineId } },
    })

    if (existing) {
      await db.wishlistItem.delete({ where: { id: existing.id } })
      const rest = await db.wishlistItem.findMany({ where: { userId: user.id }, select: { medicineId: true } })
      return Response.json({ ids: rest.map((i) => i.medicineId), added: false })
    }

    await db.wishlistItem.create({ data: { userId: user.id, medicineId } })
    const rest = await db.wishlistItem.findMany({ where: { userId: user.id }, select: { medicineId: true } })
    return Response.json({ ids: rest.map((i) => i.medicineId), added: true })
  } catch (e) {
    return serverError(e)
  }
}

/** DELETE /api/wishlist?medicineId= → { ids } */
export async function DELETE(request: Request) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const { searchParams } = new URL(request.url)
    const medicineId = searchParams.get('medicineId')
    if (!medicineId) return badRequest('medicineId is required')
    await db.wishlistItem.deleteMany({ where: { userId: user.id, medicineId } })
    const rest = await db.wishlistItem.findMany({ where: { userId: user.id }, select: { medicineId: true } })
    return Response.json({ ids: rest.map((i) => i.medicineId) })
  } catch (e) {
    return serverError(e)
  }
}
