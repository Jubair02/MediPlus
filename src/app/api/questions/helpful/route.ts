import { db } from '@/lib/db'
import { requireCustomer, badRequest, notFound, serverError } from '@/lib/auth'
import { readJson } from '../../_lib'

/**
 * POST /api/questions/helpful {questionId} — toggle the caller's "helpful" vote on an ANSWERED question.
 * Auth required (any role). → 200 { questionId, helpfulCount, voted } where helpfulCount is the count
 * AFTER the toggle and voted is whether the caller's vote now exists.
 */
export async function POST(request: Request) {
  try {
    const user = await requireCustomer(request)
    if (user instanceof Response) return user
    const body = await readJson(request)
    if (!body) return badRequest('Invalid request body')

    const questionId = typeof body.questionId === 'string' ? body.questionId.trim() : ''
    if (!questionId) return badRequest('Question id is required')

    const question = await db.question.findUnique({ where: { id: questionId }, select: { id: true, status: true } })
    if (!question) return notFound('Question not found')
    if (question.status !== 'ANSWERED') return badRequest('Only answered questions can receive votes')

    const existing = await db.helpfulVote.findUnique({
      where: { questionId_userId: { questionId, userId: user.id } },
      select: { id: true },
    })
    if (existing) {
      await db.helpfulVote.delete({ where: { id: existing.id } })
    } else {
      await db.helpfulVote.create({ data: { questionId, userId: user.id } })
    }

    const helpfulCount = await db.helpfulVote.count({ where: { questionId } })
    return Response.json({ questionId, helpfulCount, voted: !existing })
  } catch (e) {
    return serverError(e)
  }
}
