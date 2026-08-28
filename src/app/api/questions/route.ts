import { db } from '@/lib/db'
import { getAuthUser, unauthorized, badRequest, notFound, forbidden, serverError } from '@/lib/auth'
import { readJson } from '../_lib'

const MAX_QUESTION_LENGTH = 600
const MIN_QUESTION_LENGTH = 5
const PUBLIC_LIMIT = 20
/** Round 11 — a PENDING question can be edited by its owner only during this window after creation. */
export const QUESTION_EDIT_WINDOW_MS = 15 * 60 * 1000

function askedName(name: string | null): string {
  return name ?? 'Customer'
}

function answerName(name: string | null): string {
  return name ?? 'Pharmacist'
}

/** Round 11 — true only when the row belongs to the caller, is still PENDING and inside the edit window (elapsed ≤ 15 min). */
function canEditQuestion(q: { userId: string; status: string; createdAt: Date }, userId?: string | null): boolean {
  if (!userId || q.userId !== userId || q.status !== 'PENDING') return false
  return Date.now() - q.createdAt.getTime() <= QUESTION_EDIT_WINDOW_MS
}

/** Sort: ANSWERED first (newest answer first), then PENDING (newest question first). */
function sortQA<T extends { status: string; answeredAt: Date | null; createdAt: Date }>(a: T, b: T): number {
  const aa = a.status === 'ANSWERED' ? 0 : 1
  const ba = b.status === 'ANSWERED' ? 0 : 1
  if (aa !== ba) return aa - ba
  if (aa === 0) return (b.answeredAt?.getTime() ?? 0) - (a.answeredAt?.getTime() ?? 0)
  return b.createdAt.getTime() - a.createdAt.getTime()
}

/** questionId → vote count, plus the caller's voted ids (empty when no valid token). */
async function voteData(questionIds: string[], userId?: string) {
  const counts = await db.helpfulVote.groupBy({ by: ['questionId'], where: { questionId: { in: questionIds } }, _count: { _all: true } })
  const countByQuestion = new Map(counts.map((c) => [c.questionId, c._count._all]))
  const mine = userId
    ? await db.helpfulVote.findMany({ where: { userId, questionId: { in: questionIds } }, select: { questionId: true } })
    : []
  return { countByQuestion, votedIds: new Set(mine.map((v) => v.questionId)) }
}

/**
 * GET /api/questions?medicineId=<id>  → public Q&A for a medicine (ANSWERED for everyone + caller's own PENDING when a valid token is sent)
 *                                       rows carry canEdit: true only for the caller's own PENDING rows still inside
 *                                       the 15-minute edit window (guests / other users → false; userId never leaked)
 * GET /api/questions?mine=1           → all of the caller's own questions (newest first) — same canEdit flag
 */
export async function GET(request: Request) {
  try {
    const sp = new URL(request.url).searchParams
    const user = await getAuthUser(request)

    if (sp.get('mine') === '1') {
      if (!user) return unauthorized()
      const questions = await db.question.findMany({
        where: { userId: user.id },
        include: {
          medicine: { select: { id: true, name: true } },
          user: { select: { name: true } },
          answeredBy: { select: { name: true } },
          _count: { select: { helpfulVotes: true } },
        },
        orderBy: { createdAt: 'desc' },
      })
      const { countByQuestion, votedIds } = await voteData(
        questions.map((q) => q.id),
        user.id
      )
      return Response.json({
        questions: questions.map((q) => ({
          id: q.id,
          question: q.question,
          answer: q.answer,
          status: q.status,
          createdAt: q.createdAt,
          answeredAt: q.answeredAt,
          medicineId: q.medicine.id,
          medicineName: q.medicine.name,
          askedByName: askedName(q.user.name),
          answerByName: q.answer ? answerName(q.answeredBy?.name ?? null) : null,
          helpfulCount: countByQuestion.get(q.id) ?? 0,
          hasVoted: votedIds.has(q.id),
          canEdit: canEditQuestion(q, user.id),
        })),
      })
    }

    const medicineId = sp.get('medicineId')?.trim()
    if (!medicineId) return badRequest('medicineId is required')
    const medicine = await db.medicine.findUnique({ where: { id: medicineId }, select: { id: true } })
    if (!medicine) return notFound('Medicine not found')

    const questions = await db.question.findMany({
      where: {
        medicineId,
        OR: [{ status: 'ANSWERED' }, ...(user ? [{ status: 'PENDING', userId: user.id }] : [])],
      },
      include: {
        user: { select: { name: true } },
        answeredBy: { select: { name: true } },
        _count: { select: { helpfulVotes: true } },
      },
    })
    questions.sort(sortQA)
    const { countByQuestion, votedIds } = await voteData(
      questions.map((q) => q.id),
      user?.id
    )
    return Response.json({
      questions: questions.slice(0, PUBLIC_LIMIT).map((q) => ({
        id: q.id,
        question: q.question,
        answer: q.answer,
        status: q.status,
        createdAt: q.createdAt,
        answeredAt: q.answeredAt,
        askedByName: askedName(q.user.name),
        answerByName: q.answer ? answerName(q.answeredBy?.name ?? null) : null,
        helpfulCount: countByQuestion.get(q.id) ?? 0,
        hasVoted: votedIds.has(q.id),
        canEdit: canEditQuestion(q, user?.id),
      })),
    })
  } catch (e) {
    return serverError(e)
  }
}

/**
 * POST /api/questions {medicineId, question} — ask a question (auth required, any role, intended CUSTOMER) → 201 {question}
 *   the returned row matches the GET ?medicineId=... shape (canEdit: true — freshly created inside the window)
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
    if (!medicine) return notFound('Medicine not found')
    if (medicine.status !== 'ACTIVE') return badRequest('Medicine not available')

    const text = typeof body.question === 'string' ? body.question.trim() : ''
    if (text.length < MIN_QUESTION_LENGTH) return badRequest(`Question must be at least ${MIN_QUESTION_LENGTH} characters`)
    if (text.length > MAX_QUESTION_LENGTH) return badRequest(`Question must be ${MAX_QUESTION_LENGTH} characters or less`)

    const created = await db.question.create({
      data: { medicineId, userId: user.id, question: text, status: 'PENDING' },
      include: {
        user: { select: { name: true } },
        answeredBy: { select: { name: true } },
      },
    })
    return Response.json(
      {
        question: {
          id: created.id,
          question: created.question,
          answer: created.answer,
          status: created.status,
          createdAt: created.createdAt,
          answeredAt: created.answeredAt,
          askedByName: askedName(created.user.name),
          answerByName: created.answer ? answerName(created.answeredBy?.name ?? null) : null,
          helpfulCount: 0,
          hasVoted: false,
          canEdit: true,
        },
      },
      { status: 201 }
    )
  } catch (e) {
    return serverError(e)
  }
}

/**
 * PUT /api/questions {id, question} — edit your own question while PENDING and inside the 15-minute edit window (auth required)
 *   401 guest · 404 unknown id ('Question not found') · 403 not owner ('You can only edit your own questions')
 *   400 non-PENDING ('Only pending questions can be edited') · 400 window passed ('The edit window has passed')
 *   400 text rules identical to POST (trim; 5 min / 600 max)
 *   → 200 {question: <same row shape as GET ?medicineId=... rows, helpfulCount 0 while pending, canEdit recomputed>}
 */
export async function PUT(request: Request) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const body = await readJson(request)
    if (!body) return badRequest('Invalid request body')

    const id = typeof body.id === 'string' ? body.id.trim() : ''
    if (!id) return badRequest('Question id is required')
    const question = await db.question.findUnique({
      where: { id },
      include: { user: { select: { name: true } }, answeredBy: { select: { name: true } } },
    })
    if (!question) return notFound('Question not found')
    if (question.userId !== user.id) return forbidden('You can only edit your own questions')
    if (question.status !== 'PENDING') return badRequest('Only pending questions can be edited')
    if (Date.now() - question.createdAt.getTime() > QUESTION_EDIT_WINDOW_MS) return badRequest('The edit window has passed')

    const text = typeof body.question === 'string' ? body.question.trim() : ''
    if (text.length < MIN_QUESTION_LENGTH) return badRequest(`Question must be at least ${MIN_QUESTION_LENGTH} characters`)
    if (text.length > MAX_QUESTION_LENGTH) return badRequest(`Question must be ${MAX_QUESTION_LENGTH} characters or less`)

    const updated = await db.question.update({
      where: { id },
      data: { question: text },
      include: { user: { select: { name: true } }, answeredBy: { select: { name: true } } },
    })
    const { countByQuestion, votedIds } = await voteData([updated.id], user.id)
    return Response.json({
      question: {
        id: updated.id,
        question: updated.question,
        answer: updated.answer,
        status: updated.status,
        createdAt: updated.createdAt,
        answeredAt: updated.answeredAt,
        askedByName: askedName(updated.user.name),
        answerByName: updated.answer ? answerName(updated.answeredBy?.name ?? null) : null,
        helpfulCount: countByQuestion.get(updated.id) ?? 0,
        hasVoted: votedIds.has(updated.id),
        canEdit: canEditQuestion(updated, user.id),
      },
    })
  } catch (e) {
    return serverError(e)
  }
}

/** DELETE /api/questions?id=<id> — owner may delete their own question while it is still PENDING */
export async function DELETE(request: Request) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const id = new URL(request.url).searchParams.get('id')
    if (!id) return badRequest('Question id is required')
    const question = await db.question.findUnique({ where: { id }, select: { id: true, userId: true, status: true } })
    if (!question) return notFound('Question not found')
    if (question.userId !== user.id) return forbidden('You can only delete your own questions')
    if (question.status !== 'PENDING') return forbidden('Only pending questions can be deleted')
    await db.question.delete({ where: { id } })
    return Response.json({ ok: true })
  } catch (e) {
    return serverError(e)
  }
}
