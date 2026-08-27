import { db } from '@/lib/db'
import { getAuthUser, unauthorized, badRequest, serverError } from '@/lib/auth'
import { readJson } from '../_lib'

/** GET /api/prescriptions (Bearer) → my prescriptions (no image), newest first, with orderNo */
export async function GET(request: Request) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const prescriptions = await db.prescription.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        note: true,
        status: true,
        reviewNote: true,
        createdAt: true,
        updatedAt: true,
        order: { select: { id: true, orderNo: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    return Response.json({
      prescriptions: prescriptions.map((p) => ({
        id: p.id,
        note: p.note,
        status: p.status,
        reviewNote: p.reviewNote,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        orderNo: p.order?.orderNo ?? null,
        orderId: p.order?.id ?? null,
      })),
    })
  } catch (e) {
    return serverError(e)
  }
}

/** POST /api/prescriptions {image, note?} — upload a prescription image (data URL) */
export async function POST(request: Request) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const body = await readJson(request)
    if (!body) return badRequest('Invalid request body')
    const image = typeof body.image === 'string' ? body.image : ''
    if (!image.startsWith('data:image')) return badRequest('Please upload a valid image')
    const note = typeof body.note === 'string' && body.note.trim() !== '' ? body.note.trim() : null
    const prescription = await db.prescription.create({
      data: { userId: user.id, image, note },
    })
    return Response.json({ prescription }, { status: 201 })
  } catch (e) {
    return serverError(e)
  }
}
