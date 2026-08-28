import { db } from '@/lib/db'
import { getAuthUser, unauthorized, badRequest, notFound, forbidden, serverError } from '@/lib/auth'
import { readJson, numOr } from '../_lib'

const MAX_COMMENT_LENGTH = 600

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** User ids (of the given reviewers) that have a DELIVERED order containing this medicine — one batched query. */
async function verifiedReviewerIds(medicineId: string, userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set()
  const rows = await db.orderItem.findMany({
    where: { medicineId, order: { status: 'DELIVERED', userId: { in: userIds } } },
    select: { order: { select: { userId: true } } },
  })
  return new Set(rows.map((r) => r.order.userId))
}

function reviewToJson(r: { id: string; rating: number; comment: string | null; createdAt: Date; userId: string; user: { id: string; name: string | null } }, verified: boolean) {
  return {
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    createdAt: r.createdAt,
    user: r.user,
    verified,
  }
}

/**
 * GET /api/reviews?medicineId=<id> → { summary: { avg, count, distribution }, reviews }
 */
export async function GET(request: Request) {
  try {
    const medicineId = new URL(request.url).searchParams.get('medicineId')?.trim()
    if (!medicineId) return badRequest('medicineId is required')
    const medicine = await db.medicine.findUnique({ where: { id: medicineId }, select: { id: true } })
    if (!medicine) return notFound('Medicine not found')

    const reviews = await db.review.findMany({
      where: { medicineId },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    })
    const verifiedSet = await verifiedReviewerIds(medicineId, Array.from(new Set(reviews.map((r) => r.userId))))

    const avg = reviews.length === 0 ? 0 : reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
    const summary = {
      avg: round1(avg),
      count: reviews.length,
      distribution: [5, 4, 3, 2, 1].map((rating) => ({ rating, count: reviews.filter((r) => r.rating === rating).length })),
    }
    return Response.json({
      summary,
      reviews: reviews.map((r) => reviewToJson(r, verifiedSet.has(r.userId))),
    })
  } catch (e) {
    return serverError(e)
  }
}

/**
 * POST /api/reviews {medicineId, rating, comment?} — create or update the caller's review (upsert on user+medicine).
 */
export async function POST(request: Request) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const body = await readJson(request)
    if (!body) return badRequest('Invalid request body')

    const medicineId = typeof body.medicineId === 'string' ? body.medicineId.trim() : ''
    if (!medicineId) return badRequest('Medicine id is required')
    const medicine = await db.medicine.findUnique({ where: { id: medicineId }, select: { id: true, status: true } })
    if (!medicine || medicine.status !== 'ACTIVE') return badRequest('Medicine not available')

    const rating = numOr(body.rating, NaN)
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return badRequest('Rating must be between 1 and 5')

    const trimmed = typeof body.comment === 'string' ? body.comment.trim() : ''
    if (trimmed.length > MAX_COMMENT_LENGTH) return badRequest(`Comment must be ${MAX_COMMENT_LENGTH} characters or less`)
    const comment = trimmed === '' ? null : trimmed

    const review = await db.review.upsert({
      where: { userId_medicineId: { userId: user.id, medicineId } },
      update: { rating, comment },
      create: { userId: user.id, medicineId, rating, comment },
      include: { user: { select: { id: true, name: true } } },
    })

    const verifiedSet = await verifiedReviewerIds(medicineId, [user.id])
    return Response.json({ review: reviewToJson(review, verifiedSet.has(user.id)) }, { status: 201 })
  } catch (e) {
    return serverError(e)
  }
}

/** DELETE /api/reviews?id=<id> — owner only */
export async function DELETE(request: Request) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const id = new URL(request.url).searchParams.get('id')
    if (!id) return badRequest('Review id is required')
    const review = await db.review.findUnique({ where: { id }, select: { id: true, userId: true } })
    if (!review) return notFound('Review not found')
    if (review.userId !== user.id) return forbidden('You can only delete your own reviews')
    await db.review.delete({ where: { id } })
    return Response.json({ ok: true })
  } catch (e) {
    return serverError(e)
  }
}
