import { db } from '@/lib/db'
import { requireRole, badRequest, notFound, forbidden, serverError } from '@/lib/auth'
import { readJson, optStr, numOr, logAudit, notify, notifyAdmins } from '../_lib'
import {
  canTransition,
  deriveItemStatusAfterReview,
  deriveRequestStatusAfterReview,
  isEditable,
  isReviewable,
  validateApproval,
  type ApprovalDecision,
  type RequestLine,
} from '@/lib/stock-request'
import type { Prisma, StockRequestPriority, StockRequestStatus } from '@prisma/client'

/**
 * Stock requests — the ask, the review, and the authority to buy.
 *
 * Nothing in this file moves stock. Creating a request, approving it and converting
 * it into purchase orders all leave `Medicine.stock` untouched; units change only when
 * a delivery is booked in through `receive-po`, which owns the stock engine. That
 * separation is the whole point of the workflow, so it is worth stating plainly here:
 * if a future change makes this file write to `Medicine.stock`, the change is wrong.
 *
 * This route deliberately does NOT live in the pharmacist route, which is gated
 * `requireRole(['PHARMACIST'])` — admins have to be able to review, and that exclusion
 * is exactly what left them with no procurement visibility in the first place.
 */

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'EMERGENCY'] as const
const MAX_REASON_LENGTH = 500
const MAX_NOTE_LENGTH = 300
const MAX_ITEMS = 50
const MAX_QTY = 10000

/** Raised inside a transaction when another request already moved this row on. */
class LostRaceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LostRaceError'
  }
}

const requestInclude = {
  requestedBy: { select: { id: true, name: true, email: true } },
  reviewedBy: { select: { id: true, name: true, email: true } },
  items: {
    include: {
      medicine: { select: { id: true, name: true, unit: true, image: true, brand: true, stock: true } },
      purchaseOrders: {
        select: { id: true, qty: true, status: true, receivedQty: true, supplier: true, expectedAt: true, orderedAt: true },
      },
    },
    // `id` breaks the tie: lines created in one call share a createdAt to the
    // millisecond, so ordering on the timestamp alone is arbitrary and the same
    // request comes back with its lines in a different order each time.
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.StockRequestInclude

type FullRequest = Awaited<ReturnType<typeof loadRequest>>

async function loadRequest(id: string) {
  return db.stockRequest.findUnique({ where: { id }, include: requestInclude })
}

/**
 * Shape a request for the client, deriving ordered and received quantities from the
 * purchase orders and their receipts rather than reading a stored counter. Nothing
 * gates a write here, so there is no counter to keep in step and nothing to drift.
 */
function toRow(r: NonNullable<FullRequest>) {
  const items = r.items.map((it) => {
    const live = it.purchaseOrders.filter((po) => po.status !== 'CANCELLED')
    const orderedQty = live.reduce((s, po) => s + po.qty, 0)
    const receivedQty = live.reduce((s, po) => s + po.receivedQty, 0)
    const approvedQty = it.approvedQty ?? 0
    return {
      id: it.id,
      medicine: it.medicine,
      stockAtRequest: it.stockAtRequest,
      requestedQty: it.requestedQty,
      approvedQty: it.approvedQty,
      orderedQty,
      receivedQty,
      remainingQty: Math.max(0, approvedQty - receivedQty),
      status: it.status,
      note: it.note,
      reviewNote: it.reviewNote,
      purchaseOrders: it.purchaseOrders,
    }
  })
  return {
    id: r.id,
    requestNo: r.requestNo,
    status: r.status,
    priority: r.priority,
    reason: r.reason,
    requestedBy: r.requestedBy,
    reviewedBy: r.reviewedBy,
    submittedAt: r.submittedAt,
    reviewedAt: r.reviewedAt,
    reviewNote: r.reviewNote,
    expectedAt: r.expectedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    items,
    itemCount: items.length,
    totalRequested: items.reduce((s, i) => s + i.requestedQty, 0),
    totalApproved: items.reduce((s, i) => s + (i.approvedQty ?? 0), 0),
    totalReceived: items.reduce((s, i) => s + i.receivedQty, 0),
  }
}

/** "SR-100001", mirroring how Order.orderNo is minted. */
async function nextRequestNo(): Promise<string> {
  const count = await db.stockRequest.count()
  return `SR-${100000 + count + 1}`
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

/**
 * GET /api/stock-requests?resource=list|detail
 *   list   — &status= &priority= &mine=1, newest first; EMERGENCY sorted to the top
 *   detail — &id=
 */
export async function GET(request: Request) {
  try {
    const user = await requireRole(request, ['PHARMACIST', 'ADMIN'])
    if (user instanceof Response) return user
    const sp = new URL(request.url).searchParams
    const resource = sp.get('resource') ?? 'list'

    if (resource === 'detail') {
      const id = sp.get('id')?.trim()
      if (!id) return badRequest('Request id is required')
      const found = await loadRequest(id)
      if (!found) return notFound('Stock request not found')
      // A draft is private to its author until it is submitted.
      if (found.status === 'DRAFT' && found.requestedById !== user.id) {
        return notFound('Stock request not found')
      }
      return Response.json({ request: toRow(found) })
    }

    if (resource === 'list') {
      const status = sp.get('status')?.trim()
      const priority = sp.get('priority')?.trim()
      const mine = sp.get('mine') === '1'

      const rows = await db.stockRequest.findMany({
        where: {
          ...(status && status !== 'ALL' ? { status: status as StockRequestStatus } : {}),
          ...(priority && priority !== 'ALL' ? { priority: priority as StockRequestPriority } : {}),
          ...(mine ? { requestedById: user.id } : {}),
          // Other people's drafts are nobody else's business.
          ...(mine ? {} : { OR: [{ status: { not: 'DRAFT' } }, { requestedById: user.id }] }),
        },
        include: requestInclude,
        orderBy: { createdAt: 'desc' },
      })

      const requests = rows.map(toRow)
      // Emergencies first, then newest. Priority raises visibility — and only that.
      requests.sort((a, b) => {
        const ae = a.priority === 'EMERGENCY' && !isFinished(a.status) ? 0 : 1
        const be = b.priority === 'EMERGENCY' && !isFinished(b.status) ? 0 : 1
        if (ae !== be) return ae - be
        return b.createdAt.getTime() - a.createdAt.getTime()
      })

      const counts = await db.stockRequest.groupBy({ by: ['status'], _count: true })
      return Response.json({
        requests,
        counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
        awaitingReview: requests.filter((r) => r.status === 'SUBMITTED' || r.status === 'UNDER_REVIEW').length,
      })
    }

    return badRequest('Unknown resource')
  } catch (e) {
    return serverError(e)
  }
}

function isFinished(status: StockRequestStatus): boolean {
  return status === 'COMPLETED' || status === 'CANCELLED' || status === 'REJECTED'
}

// ---------------------------------------------------------------------------
// PUT
// ---------------------------------------------------------------------------

/**
 * PUT /api/stock-requests
 *  {action:'create', priority?, reason?, expectedAt?, submit?, items:[{medicineId, requestedQty, note?}]}
 *  {action:'update-draft', id, priority?, reason?, expectedAt?, items:[...]}   — DRAFT only
 *  {action:'submit', id}                                — DRAFT → SUBMITTED, notifies admins
 *  {action:'start-review', id}                          — SUBMITTED → UNDER_REVIEW (ADMIN)
 *  {action:'review', id, decisions:[{itemId, approvedQty, reviewNote?}], reviewNote?}  — (ADMIN)
 *  {action:'convert-to-po', id, lines?:[{itemId, supplier?, expectedAt?}]}    — approved lines → purchase orders
 *  {action:'cancel', id, reason?}
 *
 * None of these touch Medicine.stock.
 */
export async function PUT(request: Request) {
  try {
    const user = await requireRole(request, ['PHARMACIST', 'ADMIN'])
    if (user instanceof Response) return user
    const body = await readJson(request)
    if (!body) return badRequest('Invalid request body')
    const action = optStr(body.action)

    // ---- create (optionally submitting straight away) ----
    if (action === 'create') {
      const parsed = await parseItems(body.items)
      if ('error' in parsed) return badRequest(parsed.error)
      const meta = parseMeta(body)
      if ('error' in meta) return badRequest(meta.error)

      const submitNow = body.submit === true
      const created = await db.stockRequest.create({
        data: {
          requestNo: await nextRequestNo(),
          status: submitNow ? 'SUBMITTED' : 'DRAFT',
          submittedAt: submitNow ? new Date() : null,
          priority: meta.priority,
          reason: meta.reason,
          expectedAt: meta.expectedAt,
          requestedById: user.id,
          items: {
            create: parsed.items.map((i) => ({
              medicineId: i.medicineId,
              requestedQty: i.requestedQty,
              // Snapshot, so the reviewer sees what the requester was looking at.
              stockAtRequest: i.stock,
              note: i.note,
            })),
          },
        },
        include: requestInclude,
      })

      await logAudit(db, user, {
        action: 'SR_CREATE',
        entityType: 'STOCK_REQUEST',
        entityRef: created.requestNo,
        detail: `${parsed.items.length} item(s), ${meta.priority.toLowerCase()} priority${submitNow ? ', submitted' : ' (draft)'}`,
      })
      if (submitNow) await announceSubmission(created.requestNo, meta.priority, user)

      return Response.json({ request: toRow(created) }, { status: 201 })
    }

    // ---- everything else needs an existing request ----
    const id = optStr(body.id)
    if (!id) return badRequest('Request id is required')
    const existing = await loadRequest(id)
    if (!existing) return notFound('Stock request not found')

    // ---- update a draft ----
    if (action === 'update-draft') {
      if (existing.requestedById !== user.id) return forbidden('Only the author can edit this request')
      if (!isEditable(existing.status)) return badRequest('Only a draft can be edited. Cancel it and raise a new one.')

      const parsed = await parseItems(body.items)
      if ('error' in parsed) return badRequest(parsed.error)
      const meta = parseMeta(body)
      if ('error' in meta) return badRequest(meta.error)

      const updated = await db.$transaction(async (tx) => {
        const claimed = await tx.stockRequest.updateMany({
          where: { id, status: 'DRAFT' },
          data: { priority: meta.priority, reason: meta.reason, expectedAt: meta.expectedAt },
        })
        if (claimed.count === 0) throw new LostRaceError('This request is no longer a draft')
        // Replace the lines wholesale: a draft has no history worth preserving, and
        // diffing would only invent a way for quantities to disagree with the form.
        await tx.stockRequestItem.deleteMany({ where: { requestId: id } })
        await tx.stockRequestItem.createMany({
          data: parsed.items.map((i) => ({
            requestId: id,
            medicineId: i.medicineId,
            requestedQty: i.requestedQty,
            stockAtRequest: i.stock,
            note: i.note,
          })),
        })
        return tx.stockRequest.findUnique({ where: { id }, include: requestInclude })
      })
      return Response.json({ request: toRow(updated!) })
    }

    // ---- submit ----
    if (action === 'submit') {
      if (existing.requestedById !== user.id) return forbidden('Only the author can submit this request')
      if (!canTransition(existing.status, 'SUBMITTED')) {
        return badRequest(`A ${label(existing.status)} request cannot be submitted`)
      }
      if (existing.items.length === 0) return badRequest('Add at least one medicine before submitting')

      const claimed = await db.stockRequest.updateMany({
        where: { id, status: 'DRAFT' },
        data: { status: 'SUBMITTED', submittedAt: new Date() },
      })
      if (claimed.count === 0) return badRequest('This request has already been submitted')

      await logAudit(db, user, {
        action: 'SR_SUBMIT',
        entityType: 'STOCK_REQUEST',
        entityRef: existing.requestNo,
        detail: `${existing.items.length} item(s), ${existing.priority.toLowerCase()} priority`,
      })
      await announceSubmission(existing.requestNo, existing.priority, user)

      const fresh = await loadRequest(id)
      return Response.json({ request: toRow(fresh!) })
    }

    // ---- start review (admin) ----
    if (action === 'start-review') {
      if (user.role !== 'ADMIN') return forbidden('Only an admin can review stock requests')
      if (existing.requestedById === user.id) {
        return badRequest('You cannot review a request you raised yourself. Ask another admin to review it.')
      }
      if (!canTransition(existing.status, 'UNDER_REVIEW')) {
        return badRequest(`A ${label(existing.status)} request is not awaiting review`)
      }
      const claimed = await db.stockRequest.updateMany({
        where: { id, status: 'SUBMITTED' },
        data: { status: 'UNDER_REVIEW', reviewedById: user.id },
      })
      if (claimed.count === 0) return badRequest('Someone else has already picked up this request')

      const fresh = await loadRequest(id)
      return Response.json({ request: toRow(fresh!) })
    }

    // ---- review: approve / cut / reject, per item, in one transaction ----
    if (action === 'review') {
      if (user.role !== 'ADMIN') return forbidden('Only an admin can review stock requests')
      // The control this whole workflow exists to provide. Enforced here, not in the UI.
      if (existing.requestedById === user.id) {
        return badRequest('You cannot approve a request you raised yourself. Ask another admin to review it.')
      }
      if (!isReviewable(existing.status)) {
        return badRequest(`A ${label(existing.status)} request has already been decided`)
      }

      const rawDecisions = Array.isArray(body.decisions) ? body.decisions : null
      if (!rawDecisions) return badRequest('Decisions are required')

      const decisions: ApprovalDecision[] = []
      const notes = new Map<string, string | null>()
      for (const raw of rawDecisions) {
        if (typeof raw !== 'object' || raw === null) return badRequest('Invalid decision')
        const d = raw as Record<string, unknown>
        const itemId = optStr(d.itemId)
        if (!itemId) return badRequest('Each decision needs an item id')
        decisions.push({ itemId, approvedQty: numOr(d.approvedQty, NaN) })
        const note = optStr(d.reviewNote)?.trim()
        if (note && note.length > MAX_NOTE_LENGTH) return badRequest('Item note must be 300 characters or less')
        notes.set(itemId, note || null)
      }

      const lines: RequestLine[] = existing.items.map((i) => ({
        id: i.id,
        requestedQty: i.requestedQty,
        approvedQty: i.approvedQty,
      }))
      const check = validateApproval(lines, decisions)
      if ('error' in check) return badRequest(check.error)

      const reviewNote = optStr(body.reviewNote)?.trim() || null
      if (reviewNote && reviewNote.length > MAX_REASON_LENGTH) {
        return badRequest('Review note must be 500 characters or less')
      }

      // The header status is DERIVED from the decided lines, never taken from the
      // client, so a request can never read APPROVED while carrying a rejected item.
      const decided: RequestLine[] = lines.map((l) => ({
        ...l,
        approvedQty: decisions.find((d) => d.itemId === l.id)!.approvedQty,
      }))
      const nextStatus = deriveRequestStatusAfterReview(decided)

      try {
        await db.$transaction(async (tx) => {
          const claimed = await tx.stockRequest.updateMany({
            where: { id, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } },
            data: { status: nextStatus, reviewedById: user.id, reviewedAt: new Date(), reviewNote },
          })
          if (claimed.count === 0) throw new LostRaceError('This request was reviewed by someone else')

          for (const line of decided) {
            await tx.stockRequestItem.update({
              where: { id: line.id },
              data: {
                approvedQty: line.approvedQty,
                status: deriveItemStatusAfterReview(line),
                reviewNote: notes.get(line.id) ?? null,
              },
            })
          }

          await logAudit(tx, user, {
            action: 'SR_REVIEW',
            entityType: 'STOCK_REQUEST',
            entityRef: existing.requestNo,
            detail: reviewDetail(existing.items, decided, nextStatus),
          })
        })
      } catch (e) {
        if (e instanceof LostRaceError) return badRequest(e.message)
        throw e
      }

      await notify(
        existing.requestedById,
        `Stock request ${label(nextStatus).toLowerCase()}`,
        `${existing.requestNo} was ${label(nextStatus).toLowerCase()}${reviewNote ? `. ${reviewNote}` : '.'}`
      )

      const fresh = await loadRequest(id)
      return Response.json({ request: toRow(fresh!) })
    }

    // ---- convert approved lines into purchase orders ----
    if (action === 'convert-to-po') {
      if (existing.status !== 'APPROVED' && existing.status !== 'PARTIALLY_APPROVED') {
        return badRequest('Only an approved request can be turned into purchase orders')
      }

      const row = toRow(existing)
      // Only what is approved and not yet on an order — so converting twice cannot
      // double-order, whether by a double-click or a second deliberate attempt.
      const outstanding = row.items.filter((i) => (i.approvedQty ?? 0) > i.orderedQty)
      if (outstanding.length === 0) {
        return badRequest('Every approved item on this request is already on a purchase order')
      }

      const overrides = new Map<string, { supplier: string | null; expectedAt: Date | null }>()
      if (Array.isArray(body.lines)) {
        for (const raw of body.lines) {
          if (typeof raw !== 'object' || raw === null) continue
          const l = raw as Record<string, unknown>
          const itemId = optStr(l.itemId)
          if (!itemId) continue
          const supplier = optStr(l.supplier)?.trim() || null
          if (supplier && supplier.length > 120) return badRequest('Supplier must be 120 characters or less')
          const expectedAt = parseDate(l.expectedAt)
          if (expectedAt === 'invalid') return badRequest('Invalid expected date')
          overrides.set(itemId, { supplier, expectedAt })
        }
      }

      const createdIds = await db.$transaction(async (tx) => {
        const ids: string[] = []
        for (const item of outstanding) {
          const qty = (item.approvedQty ?? 0) - item.orderedQty
          const o = overrides.get(item.id)
          const po = await tx.purchaseOrder.create({
            data: {
              medicineId: item.medicine.id,
              qty,
              status: 'ORDERED',
              note: `From stock request ${existing.requestNo}`,
              supplier: o?.supplier ?? null,
              expectedAt: o?.expectedAt ?? existing.expectedAt,
              orderedById: user.id,
              stockRequestItemId: item.id,
            },
          })
          ids.push(po.id)
          await tx.stockRequestItem.update({ where: { id: item.id }, data: { status: 'ORDERED' } })
          await logAudit(tx, user, {
            action: 'PO_CREATE',
            entityType: 'PURCHASE_ORDER',
            entityRef: po.id,
            detail: `Ordered ${qty} × ${item.medicine.name} from stock request ${existing.requestNo}`,
          })
        }

        const claimed = await tx.stockRequest.updateMany({
          where: { id, status: { in: ['APPROVED', 'PARTIALLY_APPROVED'] } },
          data: { status: 'ORDERED' },
        })
        if (claimed.count === 0) throw new LostRaceError('This request has already been converted')

        await logAudit(tx, user, {
          action: 'SR_CONVERT',
          entityType: 'STOCK_REQUEST',
          entityRef: existing.requestNo,
          detail: `${ids.length} purchase order(s) raised`,
        })
        return ids
      }).catch((e) => {
        if (e instanceof LostRaceError) return null
        throw e
      })

      if (createdIds === null) return badRequest('This request has already been converted')

      const fresh = await loadRequest(id)
      return Response.json({ request: toRow(fresh!), purchaseOrderIds: createdIds })
    }

    // ---- cancel ----
    if (action === 'cancel') {
      const isAuthor = existing.requestedById === user.id
      if (!isAuthor && user.role !== 'ADMIN') {
        return forbidden('Only the author or an admin can cancel this request')
      }
      if (!canTransition(existing.status, 'CANCELLED')) {
        return badRequest(`A ${label(existing.status)} request can no longer be cancelled`)
      }
      const reason = optStr(body.reason)?.trim() || null
      const claimed = await db.stockRequest.updateMany({
        where: { id, status: existing.status },
        data: { status: 'CANCELLED', reviewNote: reason ?? existing.reviewNote },
      })
      if (claimed.count === 0) return badRequest('This request has just changed. Reload and try again.')

      await logAudit(db, user, {
        action: 'SR_CANCEL',
        entityType: 'STOCK_REQUEST',
        entityRef: existing.requestNo,
        detail: reason ? `Cancelled: ${reason}` : 'Cancelled',
      })
      if (!isAuthor) {
        await notify(existing.requestedById, 'Stock request cancelled', `${existing.requestNo} was cancelled.${reason ? ` ${reason}` : ''}`)
      }

      const fresh = await loadRequest(id)
      return Response.json({ request: toRow(fresh!) })
    }

    return badRequest('Invalid action')
  } catch (e) {
    if (e instanceof LostRaceError) return badRequest(e.message)
    return serverError(e)
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function label(status: StockRequestStatus): string {
  return status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ')
}

function parseDate(raw: unknown): Date | null | 'invalid' {
  if (raw === undefined || raw === null || raw === '') return null
  if (typeof raw !== 'string') return 'invalid'
  const s = raw.trim()
  // 'YYYY-MM-DD' is local midnight, matching how create-po reads expected dates.
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? (() => {
        const [y, m, d] = s.split('-').map(Number)
        return new Date(y, m - 1, d)
      })()
    : new Date(s)
  return Number.isNaN(dt.getTime()) ? 'invalid' : dt
}

function parseMeta(body: Record<string, unknown>):
  | { error: string }
  | { priority: StockRequestPriority; reason: string | null; expectedAt: Date | null } {
  const rawPriority = optStr(body.priority) ?? 'MEDIUM'
  if (!PRIORITIES.includes(rawPriority as (typeof PRIORITIES)[number])) {
    return { error: 'Priority must be LOW, MEDIUM, HIGH or EMERGENCY' }
  }
  const reason = optStr(body.reason)?.trim() || null
  if (reason && reason.length > MAX_REASON_LENGTH) {
    return { error: 'Reason must be 500 characters or less' }
  }
  const expectedAt = parseDate(body.expectedAt)
  if (expectedAt === 'invalid') return { error: 'Invalid expected date' }
  return { priority: rawPriority as StockRequestPriority, reason, expectedAt }
}

/**
 * Validate the requested lines and take the stock snapshot in one pass.
 *
 * The medicine must exist and be sellable — there is no point ordering more of
 * something withdrawn from the catalogue, and it would leave stock nobody can sell.
 */
async function parseItems(
  raw: unknown
): Promise<{ error: string } | { items: { medicineId: string; requestedQty: number; stock: number; note: string | null }[] }> {
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'Add at least one medicine to the request' }
  if (raw.length > MAX_ITEMS) return { error: `A request can hold at most ${MAX_ITEMS} medicines` }

  const seen = new Set<string>()
  const parsed: { medicineId: string; requestedQty: number; note: string | null }[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) return { error: 'Invalid request item' }
    const e = entry as Record<string, unknown>
    const medicineId = optStr(e.medicineId)?.trim()
    if (!medicineId) return { error: 'Each item needs a medicine' }
    if (seen.has(medicineId)) return { error: 'The same medicine appears twice. Combine the quantities into one line.' }
    seen.add(medicineId)

    const requestedQty = numOr(e.requestedQty, NaN)
    if (!Number.isInteger(requestedQty) || requestedQty < 1 || requestedQty > MAX_QTY) {
      return { error: `Requested quantity must be a whole number between 1 and ${MAX_QTY}` }
    }
    const note = optStr(e.note)?.trim() || null
    if (note && note.length > MAX_NOTE_LENGTH) return { error: 'Item note must be 300 characters or less' }
    parsed.push({ medicineId, requestedQty, note })
  }

  const medicines = await db.medicine.findMany({
    where: { id: { in: [...seen] } },
    select: { id: true, name: true, stock: true, status: true },
  })
  const byId = new Map(medicines.map((m) => [m.id, m]))
  for (const id of seen) {
    const m = byId.get(id)
    if (!m) return { error: 'One of the selected medicines no longer exists' }
    if (m.status !== 'ACTIVE') return { error: `${m.name} is not an active product and cannot be ordered` }
  }

  return {
    items: parsed.map((p) => ({ ...p, stock: byId.get(p.medicineId)!.stock })),
  }
}

/** A readable summary of a review, for the audit trail. */
function reviewDetail(
  before: { id: string; requestedQty: number; medicineId: string }[],
  decided: RequestLine[],
  status: StockRequestStatus
): string {
  const full = decided.filter((d) => d.approvedQty === d.requestedQty).length
  const cut = decided.filter((d) => (d.approvedQty ?? 0) > 0 && d.approvedQty! < d.requestedQty).length
  const rejected = decided.filter((d) => d.approvedQty === 0).length
  const parts = [`${label(status)}`]
  if (full) parts.push(`${full} approved in full`)
  if (cut) parts.push(`${cut} reduced`)
  if (rejected) parts.push(`${rejected} rejected`)
  return parts.join(' — ')
}

/** Tell the admins a request is waiting, loudly if it is an emergency. */
async function announceSubmission(
  requestNo: string,
  priority: StockRequestPriority,
  actor: { id: string; name?: string | null; email: string }
): Promise<void> {
  const who = actor.name ?? actor.email
  const urgent = priority === 'EMERGENCY'
  await notifyAdmins(
    db,
    urgent ? `EMERGENCY stock request ${requestNo}` : `Stock request ${requestNo} awaiting review`,
    `${who} submitted ${requestNo}${urgent ? ' as an emergency' : ` (${priority.toLowerCase()} priority)`}. It needs review before anything can be ordered.`,
    { exceptUserId: actor.id }
  )
}

