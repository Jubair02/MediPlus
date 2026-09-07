import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requireRole, badRequest, notFound, forbidden, serverError } from '@/lib/auth'
import { ExpiredMedicineError, expiredSaleMessage, isExpired, notExpiredFilter, startOfToday } from '@/lib/expiry'
import {
  RECEIVABLE_PO_STATUSES,
  nextPoStatus,
  receiptClaimReceivedQty,
  resolveReceiptQty,
} from '@/lib/stock-request'
import { refreshRequestProgress, readJson, optStr, numParam, numOr, round2, escapeCsv, buildMedicineData, medicineStaffJson, orderInclude, parseOrder, notify, recordStockMovements, logAudit, rxExpiryFields, StockConflictError, updateMedicineWithStockGuard, RX_VALIDITY_DAYS, RX_EXPIRY_WARNING_DAYS, type StockMovementEntry } from '../_lib'

/** Raised inside the review transaction when another request already reviewed this prescription. */
class AlreadyReviewedError extends Error {
  constructor() { super('Already reviewed'); this.name = 'AlreadyReviewedError' }
}

/** Raised when a purchase order was already received by a concurrent request. */
class AlreadyReceivedError extends Error {
  constructor() { super('This purchase order has already been received'); this.name = 'AlreadyReceivedError' }
}

/** Raised inside the review transaction when stock ran out between the check and the decrement. */
class InsufficientStockError extends Error {
  constructor(public itemName: string) {
    super(`Insufficient stock for ${itemName}`)
    this.name = 'InsufficientStockError'
  }
}

const RX_STATUSES = ['PENDING', 'APPROVED', 'REJECTED']
const ORDER_STATUSES = ['PENDING', 'PRESCRIPTION_REVIEW', 'CONFIRMED', 'PROCESSING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'FAILED']
const QA_STATUSES = ['PENDING', 'ANSWERED', 'REJECTED']
/** Same low-stock threshold used by pharmacist stats (lowStockCount / lowStock list). */
const LOW_STOCK_THRESHOLD = 10
const RESTOCK_WINDOW_DAYS = 30
const MAX_ANSWER_LENGTH = 1000
/** Round 10 — purchase order limits. */
const PO_MAX_QTY = 10000
const PO_MAX_NOTE_LENGTH = 300
/** Round 11 — purchase order supplier / expected-delivery limits. */
const PO_MAX_SUPPLIER_LENGTH = 120

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function csvDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}${m}${day}`
}

function csvRow(values: unknown[]): string {
  return values.map(escapeCsv).join(',')
}

interface QuestionRow {
  id: string
  question: string
  answer: string | null
  status: string
  createdAt: Date
  updatedAt: Date
  answeredAt: Date | null
  medicine: { id: string; name: string; image: string | null }
  user: { name: string | null; email: string }
  answeredBy: { name: string | null } | null
  _count: { helpfulVotes: number }
}

function questionToJson(q: QuestionRow) {
  return {
    id: q.id,
    question: q.question,
    answer: q.answer,
    status: q.status,
    createdAt: q.createdAt,
    answeredAt: q.answeredAt,
    medicineId: q.medicine.id,
    medicineName: q.medicine.name,
    medicineImage: q.medicine.image,
    askedByName: q.user.name ?? 'Customer',
    askedByEmail: q.user.email,
    answerByName: q.answer ? q.answeredBy?.name ?? 'Pharmacist' : null,
    // Round 11 — question text was edited while PENDING (updatedAt moved >2s past createdAt)
    edited: q.updatedAt.getTime() - q.createdAt.getTime() > 2000,
    helpfulCount: q._count.helpfulVotes,
  }
}

const questionInclude = {
  medicine: { select: { id: true, name: true, image: true } },
  user: { select: { name: true, email: true } },
  answeredBy: { select: { name: true } },
  _count: { select: { helpfulVotes: true } },
  // note: updatedAt (needed for the Round 11 `edited` flag) is a scalar — always present on include rows
} satisfies Prisma.QuestionInclude

/** Shared include for purchase-order rows — carries the medicine's live stock for currentStock. */
const poInclude = {
  medicine: { select: { id: true, name: true, unit: true, image: true, brand: true, stock: true } },
  orderedBy: { select: { id: true, name: true } },
  receivedBy: { select: { id: true, name: true } },
} satisfies Prisma.PurchaseOrderInclude

type FullPO = Prisma.PurchaseOrderGetPayload<{ include: typeof poInclude }>

function poToRow(po: FullPO) {
  return {
    id: po.id,
    qty: po.qty,
    // Deliveries can arrive in instalments, so the client needs progress, not just a
    // status: `remainingQty` is what the receive dialog defaults to and caps at.
    receivedQty: po.receivedQty,
    remainingQty: Math.max(0, po.qty - po.receivedQty),
    status: po.status,
    note: po.note,
    supplier: po.supplier,
    expectedAt: po.expectedAt,
    orderedAt: po.orderedAt,
    receivedAt: po.receivedAt,
    orderedBy: { id: po.orderedBy.id, name: po.orderedBy.name },
    receivedBy: po.receivedBy ? { id: po.receivedBy.id, name: po.receivedBy.name } : null,
    medicine: { id: po.medicine.id, name: po.medicine.name, unit: po.medicine.unit, image: po.medicine.image, brand: po.medicine.brand },
    currentStock: po.medicine.stock,
  }
}

/** Low-stock ACTIVE medicines with 30-day sales velocity → reorder suggestions. */
async function restockSuggestions() {
  const since = new Date(Date.now() - RESTOCK_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const medicines = await db.medicine.findMany({
    where: { status: 'ACTIVE', stock: { lte: LOW_STOCK_THRESHOLD } },
    orderBy: { stock: 'asc' },
  })
  const ids = medicines.map((m) => m.id)
  const soldRows = ids.length
    ? await db.orderItem.findMany({
        where: {
          medicineId: { in: ids },
          order: { status: { notIn: ['CANCELLED', 'FAILED'] }, createdAt: { gte: since } },
        },
        select: { medicineId: true, quantity: true },
      })
    : []
  const soldByMed = new Map<string, number>()
  for (const row of soldRows) {
    if (row.medicineId) soldByMed.set(row.medicineId, (soldByMed.get(row.medicineId) ?? 0) + row.quantity)
  }
  // Round 10 — total qty across each medicine's OPEN (ORDERED) purchase orders
  const openPoGroups = ids.length
    ? await db.purchaseOrder.groupBy({ by: ['medicineId'], where: { medicineId: { in: ids }, status: 'ORDERED' }, _sum: { qty: true } })
    : []
  const openPoByMed = new Map(openPoGroups.map((g) => [g.medicineId, g._sum.qty ?? 0]))

  const suggestions = medicines.map((m) => {
    const soldLast30 = soldByMed.get(m.id) ?? 0
    const avgDaily = round1(soldLast30 / RESTOCK_WINDOW_DAYS)
    let daysLeft: number | null
    if (m.stock <= 0) daysLeft = 0
    else if (avgDaily <= 0) daysLeft = null
    else daysLeft = round1(m.stock / avgDaily)
    const base = Math.max(30, Math.ceil(soldLast30 * 1.5)) - m.stock
    let suggestedQty = Math.ceil(Math.max(base, 10) / 10) * 10
    if (m.stock <= 0) suggestedQty = Math.max(suggestedQty, 30)
    return {
      id: m.id,
      name: m.name,
      brand: m.brand,
      genericName: m.genericName,
      unit: m.unit,
      image: m.image,
      stock: m.stock,
      lowStockAt: LOW_STOCK_THRESHOLD,
      soldLast30,
      avgDaily,
      daysLeft,
      suggestedQty,
      estValue: round2(suggestedQty * (m.discountPrice ?? m.price)),
      openPoQty: openPoByMed.get(m.id) ?? 0,
    }
  })
  // daysLeft asc (nulls last), then stock asc
  suggestions.sort((a, b) => {
    const an = a.daysLeft === null ? 1 : 0
    const bn = b.daysLeft === null ? 1 : 0
    if (an !== bn) return an - bn
    if (a.daysLeft !== null && b.daysLeft !== null && a.daysLeft !== b.daysLeft) return a.daysLeft - b.daysLeft
    return a.stock - b.stock
  })
  return { suggestions }
}

/**
 * GET /api/pharmacist?resource=stats|prescriptions|medicines|orders|movements|questions|restock-suggestions|purchase-orders|export-restock
 *   resource=medicines       — staff rows carry extraImages (urls sorted asc) + imageCount (Round 11 gallery)
 *   resource=questions       — rows carry edited: true when the text was edited while PENDING (Round 11)
 *   resource=purchase-orders — rows carry supplier / expectedAt (Round 11)
 */
export async function GET(request: Request) {
  try {
    // Admins are admitted to this route so they can see procurement and the stock
    // ledger — being locked out of it entirely is what left the role with the widest
    // authority over stock and the narrowest view of it. Clinical resources stay
    // pharmacist-only, enforced per resource just below.
    const user = await requireRole(request, ['PHARMACIST', 'ADMIN'])
    if (user instanceof Response) return user
    const sp = new URL(request.url).searchParams
    const resource = sp.get('resource') || 'stats'

    // Prescriptions and customer questions are clinical work, not procurement.
    if (user.role !== 'PHARMACIST' && (resource === 'prescriptions' || resource === 'questions')) {
      return forbidden('Requires role: PHARMACIST')
    }

    if (resource === 'stats') {
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      const in90Days = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
      // APPROVED rx whose approval expires within RX_EXPIRY_WARNING_DAYS (expiresAt = reviewedAt + RX_VALIDITY_DAYS ≤ now + 14d,
      // i.e. reviewedAt ≤ now − 76d) — includes already-expired approvals.
      const rxExpiringCutoff = new Date(Date.now() - (RX_VALIDITY_DAYS - RX_EXPIRY_WARNING_DAYS) * 24 * 60 * 60 * 1000)
      const [pendingPrescriptions, approvedToday, rejectedToday, totalMedicines, lowStockCount, prescriptionMedicines, lowStock, expiringSoon, expiringSoonCount, rxExpiringSoon, openPoCount] =
        await Promise.all([
          db.prescription.count({ where: { status: 'PENDING' } }),
          db.prescription.count({ where: { status: 'APPROVED', updatedAt: { gte: todayStart } } }),
          db.prescription.count({ where: { status: 'REJECTED', updatedAt: { gte: todayStart } } }),
          db.medicine.count({ where: { status: 'ACTIVE' } }),
          db.medicine.count({ where: { status: 'ACTIVE', stock: { lte: 10 } } }),
          db.medicine.count({ where: { status: 'ACTIVE', requiresPrescription: true } }),
          db.medicine.findMany({
            where: { status: 'ACTIVE', stock: { lte: 10 } },
            include: { category: true },
            orderBy: { stock: 'asc' },
            take: 10,
          }),
          db.medicine.findMany({
            where: { status: 'ACTIVE', expiryDate: { not: null, lte: in90Days } },
            include: { category: true },
            orderBy: { expiryDate: 'asc' },
            take: 10,
          }),
          db.medicine.count({ where: { status: 'ACTIVE', expiryDate: { not: null, lte: in90Days } } }),
          db.prescription.count({ where: { status: 'APPROVED', reviewedAt: { not: null, lte: rxExpiringCutoff } } }),
          db.purchaseOrder.count({ where: { status: 'ORDERED' } }),
        ])
      return Response.json({
        stats: { pendingPrescriptions, approvedToday, rejectedToday, totalMedicines, lowStockCount, prescriptionMedicines, lowStock, expiringSoon, expiringSoonCount, rxExpiringSoon, openPoCount },
      })
    }

    if (resource === 'prescriptions') {
      const status = sp.get('status')
      const where = status && RX_STATUSES.includes(status) ? { status } : {}
      const prescriptions = await db.prescription.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true, phone: true } },
          orders: { select: { orderNo: true }, orderBy: { createdAt: 'asc' }, take: 1 },
        },
        orderBy: { createdAt: 'desc' },
      })
      return Response.json({
        prescriptions: prescriptions.map((p) => ({
          id: p.id,
          image: p.image,
          note: p.note,
          status: p.status,
          reviewNote: p.reviewNote,
          createdAt: p.createdAt,
          user: p.user,
          orderNo: p.orders[0]?.orderNo ?? null,
          ...rxExpiryFields(p.status, p.reviewedAt),
        })),
      })
    }

    if (resource === 'medicines') {
      const search = sp.get('search')?.trim()
      const medicines = await db.medicine.findMany({
        where: search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { genericName: { contains: search, mode: 'insensitive' } },
                { brand: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {},
        include: { category: true, extraImages: { orderBy: { sort: 'asc' } } },
        orderBy: { createdAt: 'desc' },
      })
      return Response.json({ medicines: medicines.map(medicineStaffJson) })
    }

    if (resource === 'orders') {
      const status = sp.get('status')
      const where = status && ORDER_STATUSES.includes(status) ? { status } : {}
      const orders = await db.order.findMany({
        where,
        include: orderInclude,
        orderBy: { createdAt: 'desc' },
      })
      // PRESCRIPTION_REVIEW first, then newest first
      orders.sort((a, b) => {
        const ap = a.status === 'PRESCRIPTION_REVIEW' ? 0 : 1
        const bp = b.status === 'PRESCRIPTION_REVIEW' ? 0 : 1
        if (ap !== bp) return ap - bp
        return b.createdAt.getTime() - a.createdAt.getTime()
      })
      return Response.json({ orders: orders.map((o) => parseOrder(o)) })
    }

    if (resource === 'movements') {
      const medicineId = sp.get('medicineId')?.trim()
      const take = Math.min(100, Math.max(1, Math.trunc(numParam(sp.get('take')) ?? 50)))
      const movements = await db.stockMovement.findMany({
        where: medicineId ? { medicineId } : {},
        include: {
          medicine: { select: { id: true, name: true, image: true, unit: true } },
          user: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take,
      })
      return Response.json({
        movements: movements.map((m) => ({
          id: m.id,
          delta: m.delta,
          reason: m.reason,
          note: m.note,
          createdAt: m.createdAt,
          medicine: m.medicine,
          user: m.user,
        })),
      })
    }

    if (resource === 'questions') {
      const status = sp.get('status')
      const st = status && (status === 'ALL' || QA_STATUSES.includes(status)) ? status : 'PENDING'
      const where = st === 'ALL' ? {} : { status: st }
      const [questions, pendingCount, answeredCount, rejectedCount] = await Promise.all([
        db.question.findMany({ where, include: questionInclude, orderBy: { createdAt: 'desc' } }),
        db.question.count({ where: { status: 'PENDING' } }),
        db.question.count({ where: { status: 'ANSWERED' } }),
        db.question.count({ where: { status: 'REJECTED' } }),
      ])
      return Response.json({
        questions: questions.map(questionToJson),
        counts: { PENDING: pendingCount, ANSWERED: answeredCount, REJECTED: rejectedCount },
      })
    }

    if (resource === 'restock-suggestions') {
      return Response.json(await restockSuggestions())
    }

    if (resource === 'purchase-orders') {
      const [orders, orderedCount, receivedCount, cancelledCount] = await Promise.all([
        db.purchaseOrder.findMany({ include: poInclude, orderBy: { orderedAt: 'desc' } }),
        db.purchaseOrder.count({ where: { status: 'ORDERED' } }),
        db.purchaseOrder.count({ where: { status: 'RECEIVED' } }),
        db.purchaseOrder.count({ where: { status: 'CANCELLED' } }),
      ])
      return Response.json({
        orders: orders.map(poToRow),
        counts: { ORDERED: orderedCount, RECEIVED: receivedCount, CANCELLED: cancelledCount },
      })
    }

    if (resource === 'export-restock') {
      const { suggestions } = await restockSuggestions()
      const header = ['id', 'name', 'brand', 'genericName', 'unit', 'image', 'stock', 'lowStockAt', 'soldLast30', 'avgDaily', 'daysLeft', 'suggestedQty', 'estValue']
      const rows = suggestions.map((s) =>
        csvRow([
          s.id,
          s.name,
          s.brand ?? '',
          s.genericName ?? '',
          s.unit,
          s.image ?? '',
          s.stock,
          s.lowStockAt,
          s.soldLast30,
          s.avgDaily,
          s.daysLeft ?? '',
          s.suggestedQty,
          s.estValue,
        ])
      )
      return Response.json({ filename: `restock-${csvDate(new Date())}.csv`, csv: [csvRow(header), ...rows].join('\n') })
    }

    return badRequest('Unknown resource')
  } catch (e) {
    return serverError(e)
  }
}

/**
 * PUT /api/pharmacist
 *  {action:'review', prescriptionId, decision:'APPROVED'|'REJECTED', reviewNote?}  — sets reviewedAt + RX_REVIEW audit entry
 *  {action:'create-po', medicineId, qty, note?, supplier?, expectedAt?} — create purchase order (PO_CREATE audit entry);
 *      supplier trimmed, empty → null, ≤120 chars else 400 'Supplier must be 120 characters or less'; expectedAt
 *      'YYYY-MM-DD' (local midnight) or ISO string, NaN → 400 'Invalid expected date', before today → 400
 *      'Expected date cannot be in the past'
 *  {action:'receive-po', id, qty?, note?}            — book in one delivery: stock +qty, a PurchaseOrderReceipt row,
 *      StockMovement PO_RECEIVE and an audit entry, all in one transaction. `qty` omitted means everything still
 *      outstanding (the previous behaviour); a smaller qty leaves the order PARTIALLY_RECEIVED for the balance.
 *      Over-receipt is refused, and `note` describes this delivery — it no longer overwrites the order's own note.
 *  {action:'cancel-po', id}                          — cancel an ORDERED purchase order (PO_CANCEL audit entry)
 *  {action:'create-medicine', data:{...}}            — data.extraImages (optional, ≤5 data:/http(s): urls) persisted with sort = index
 *  {action:'update-medicine', id, data:{...}}        — data.extraImages present = REPLACE-ALL (empty array clears); absent = untouched
 *  {action:'answer', id, answer}   — answer a Q&A question (re-answer allowed, overwrites)
 *  {action:'reject', id}           — reject a Q&A question (answer/answeredBy/answeredAt cleared)
 */
export async function PUT(request: Request) {
  try {
    const user = await requireRole(request, ['PHARMACIST', 'ADMIN'])
    if (user instanceof Response) return user
    const body = await readJson(request)
    if (!body) return badRequest('Invalid request body')
    const action = optStr(body.action)

    // Clinical decisions stay with the pharmacist.
    const PHARMACIST_ONLY = ['review', 'answer', 'reject']
    if (user.role !== 'PHARMACIST' && PHARMACIST_ONLY.includes(action ?? '')) {
      return forbidden('Requires role: PHARMACIST')
    }

    if (action === 'review') {
      const prescriptionId = optStr(body.prescriptionId)
      if (!prescriptionId) return badRequest('Prescription id is required')
      const decision = optStr(body.decision)
      if (decision !== 'APPROVED' && decision !== 'REJECTED') return badRequest('Decision must be APPROVED or REJECTED')

      const prescription = await db.prescription.findUnique({
        where: { id: prescriptionId },
        include: { orders: { include: { ...orderInclude, items: { include: { medicine: true } } } } },
      })
      if (!prescription) return notFound('Prescription not found')
      if (prescription.status !== 'PENDING') return badRequest('Already reviewed')

      const reviewNote = optStr(body.reviewNote)?.trim() || null
      // A prescription can back several orders once approved, but only one is ever
      // awaiting this review — the one it was submitted with. Reused orders are already
      // CONFIRMED and must not be touched by a later review of the same prescription.
      const order = prescription.orders.find((o) => o.status === 'PRESCRIPTION_REVIEW') ?? null

      const asOf = startOfToday()

      if (decision === 'APPROVED' && order) {
        // Approving is what commits the stock this order has been waiting on, so it is
        // a sale — an out-of-date item has to stop it, and the pharmacist is told which
        // ones so they can reject the prescription or have the order amended.
        const expiredItems = order.items
          .filter((item) => isExpired(item.medicine?.expiryDate, asOf))
          .map((item) => item.name)
        if (expiredItems.length > 0) return badRequest(expiredSaleMessage(expiredItems))

        // Check stock for all Rx order items BEFORE approving
        for (const item of order.items) {
          if (!item.medicine) return badRequest(`Insufficient stock for ${item.name}`)
          if (item.medicine.status !== 'ACTIVE' || item.medicine.stock < item.quantity) {
            return badRequest(`Insufficient stock for ${item.name}`)
          }
        }
        await db.$transaction(async (tx) => {
          // Claim the review inside the transaction. The PENDING check above ran outside it,
          // so two concurrent approvals (a double-click is enough) would both pass and both
          // decrement stock. Whichever request updates zero rows lost the race and aborts.
          const claimed = await tx.prescription.updateMany({
            where: { id: prescription.id, status: 'PENDING' },
            data: { status: 'APPROVED', reviewNote, reviewedById: user.id, reviewedAt: new Date() },
          })
          if (claimed.count === 0) throw new AlreadyReviewedError()
          const movements: StockMovementEntry[] = []
          for (const item of order.items) {
            if (item.medicineId) {
              // Conditional decrement: the stock and expiry checks above also ran outside
              // the transaction, so both conditions are re-asserted here as one claim.
              const decremented = await tx.medicine.updateMany({
                where: {
                  id: item.medicineId,
                  stock: { gte: item.quantity },
                  ...notExpiredFilter(asOf),
                },
                data: { stock: { decrement: item.quantity } },
              })
              if (decremented.count === 0) {
                // The claim covers two conditions, so re-read the row to say which failed.
                const current = await tx.medicine.findUnique({
                  where: { id: item.medicineId },
                  select: { expiryDate: true },
                })
                if (isExpired(current?.expiryDate, asOf)) {
                  throw new ExpiredMedicineError([item.name])
                }
                throw new InsufficientStockError(item.name)
              }
              movements.push({
                medicineId: item.medicineId,
                delta: -item.quantity,
                reason: 'RX_APPROVE',
                note: `Order ${order.orderNo} confirmed after prescription approval`,
                userId: user.id,
              })
            }
          }
          await recordStockMovements(tx, movements)
          await tx.order.update({ where: { id: order.id }, data: { status: 'CONFIRMED' } })
          const existingPayment = await tx.payment.findUnique({ where: { orderId: order.id } })
          if (!existingPayment) {
            await tx.payment.create({
              data: {
                orderId: order.id,
                method: order.paymentMethod,
                status: order.paymentStatus === 'PAID' ? 'PAID' : 'PENDING',
                amount: order.total,
              },
            })
          }
          await tx.notification.create({
            data: { userId: order.userId, title: 'Prescription approved', message: 'Your prescription has been approved.' },
          })
          await tx.notification.create({
            data: { userId: order.userId, title: 'Order confirmed', message: `Order ${order.orderNo} has been confirmed and is being processed.` },
          })
          await logAudit(tx, user, {
            action: 'RX_REVIEW',
            entityType: 'PRESCRIPTION',
            entityRef: prescription.id,
            detail: `Prescription ${decision === 'APPROVED' ? 'approved' : 'rejected'}`,
          })
        })
      } else if (decision === 'REJECTED' && order) {
        await db.$transaction(async (tx) => {
          // Claim the review, exactly as the approval branch does. An unconditional
          // update here loses the approve/reject race in the worst possible direction:
          // a concurrent approval decrements stock and confirms the order, then this
          // write flips the row to REJECTED and cancels the order without restocking —
          // so those units leave inventory with nothing to show for them.
          const claimed = await tx.prescription.updateMany({
            where: { id: prescription.id, status: 'PENDING' },
            data: { status: 'REJECTED', reviewNote, reviewedById: user.id, reviewedAt: new Date() },
          })
          if (claimed.count === 0) throw new AlreadyReviewedError()
          await tx.order.update({ where: { id: order.id }, data: { status: 'CANCELLED', statusNote: 'Prescription rejected' } })
          await tx.notification.create({
            data: {
              userId: order.userId,
              title: 'Prescription rejected',
              message: `Your prescription was rejected.${reviewNote ? ` Reason: ${reviewNote}` : ''}`,
            },
          })
          await logAudit(tx, user, {
            action: 'RX_REVIEW',
            entityType: 'PRESCRIPTION',
            entityRef: prescription.id,
            detail: 'Prescription rejected',
          })
        })
      } else {
        // No linked order, so there is no stock to get wrong — but two reviewers must
        // still not both "win", or the audit log records a decision that was overwritten.
        const claimed = await db.prescription.updateMany({
          where: { id: prescription.id, status: 'PENDING' },
          data: { status: decision, reviewNote, reviewedById: user.id, reviewedAt: new Date() },
        })
        if (claimed.count === 0) throw new AlreadyReviewedError()
        await logAudit(db, user, {
          action: 'RX_REVIEW',
          entityType: 'PRESCRIPTION',
          entityRef: prescription.id,
          detail: `Prescription ${decision === 'APPROVED' ? 'approved' : 'rejected'}`,
        })
        await notify(
          prescription.userId,
          decision === 'APPROVED' ? 'Prescription approved' : 'Prescription rejected',
          decision === 'APPROVED'
            ? 'Your prescription has been approved.'
            : `Your prescription was rejected.${reviewNote ? ` Reason: ${reviewNote}` : ''}`
        )
      }

      const updated = await db.prescription.findUnique({
        where: { id: prescription.id },
        include: { orders: { select: { orderNo: true }, orderBy: { createdAt: 'asc' }, take: 1 } },
      })
      if (!updated) return notFound('Prescription not found')
      return Response.json({
        prescription: {
          id: updated.id,
          image: updated.image,
          note: updated.note,
          status: updated.status,
          reviewNote: updated.reviewNote,
          createdAt: updated.createdAt,
          orderNo: updated.orders[0]?.orderNo ?? null,
        },
      })
    }

    // Raising a purchase order with no stock request behind it bypasses the review
    // that the request workflow exists to impose, so it is kept as a deliberate
    // exception rather than the normal path: admins only, and it must say why.
    // Everyone else routes through Stock Request → Review → Approval → convert-to-po.
    if (action === 'create-po') {
      if (user.role !== 'ADMIN') {
        return forbidden(
          'Direct purchase orders are admin-only. Raise a stock request instead — it becomes a purchase order once approved.'
        )
      }
      const medicineId = optStr(body.medicineId)?.trim()
      if (!medicineId) return badRequest('Medicine id is required')
      const medicine = await db.medicine.findUnique({ where: { id: medicineId } })
      if (!medicine) return notFound('Medicine not found')
      if (medicine.status !== 'ACTIVE') return badRequest(`${medicine.name} is not an active product and cannot be ordered`)
      const qty = numOr(body.qty, NaN)
      if (!Number.isInteger(qty) || qty < 1 || qty > PO_MAX_QTY) return badRequest('Quantity must be between 1 and 10000')
      let note: string | null = null
      if (typeof body.note === 'string' && body.note.trim() !== '') {
        note = body.note.trim()
        if (note.length > PO_MAX_NOTE_LENGTH) return badRequest('Note must be 300 characters or less')
      }
      // Required here, unlike on a converted order, which carries its request number as
      // its justification. An order that skipped review has to record why it did.
      if (!note) {
        return badRequest('A reason is required for a direct purchase order raised without a stock request')
      }
      // Round 11 — optional supplier (trimmed, empty → null) + expected delivery date
      let supplier: string | null = null
      if (typeof body.supplier === 'string' && body.supplier.trim() !== '') {
        supplier = body.supplier.trim()
        if (supplier.length > PO_MAX_SUPPLIER_LENGTH) return badRequest('Supplier must be 120 characters or less')
      }
      let expectedAt: Date | null = null
      if (typeof body.expectedAt === 'string' && body.expectedAt.trim() !== '') {
        const raw = body.expectedAt.trim()
        // 'YYYY-MM-DD' is treated as local midnight; anything else parses as an ISO/date string
        const dt = /^\d{4}-\d{2}-\d{2}$/.test(raw)
          ? (() => {
              const [y, m, d] = raw.split('-').map(Number)
              return new Date(y, m - 1, d)
            })()
          : new Date(raw)
        if (Number.isNaN(dt.getTime())) return badRequest('Invalid expected date')
        const todayStart = new Date()
        todayStart.setHours(0, 0, 0, 0)
        if (dt.getTime() < todayStart.getTime()) return badRequest('Expected date cannot be in the past')
        expectedAt = dt
      }
      const created = await db.purchaseOrder.create({
        data: { medicineId: medicine.id, qty, note, supplier, expectedAt, orderedById: user.id },
      })
      await logAudit(db, user, {
        action: 'PO_CREATE',
        entityType: 'PURCHASE_ORDER',
        entityRef: created.id,
        // Says plainly that this one skipped review, so the exception is legible in
        // the audit log rather than looking like any other purchase order.
        detail: `Ordered ${qty} × ${medicine.name} — direct order, no stock request. Reason: ${note}`,
      })
      const fresh = await db.purchaseOrder.findUnique({ where: { id: created.id }, include: poInclude })
      if (!fresh) return notFound('Purchase order not found')
      return Response.json({ order: poToRow(fresh) })
    }

    if (action === 'receive-po') {
      const id = optStr(body.id)
      if (!id) return badRequest('Purchase order id is required')
      const po = await db.purchaseOrder.findUnique({
        where: { id },
        include: { medicine: { select: { id: true, name: true } } },
      })
      if (!po) return notFound('Purchase order not found')

      // `qty` omitted means "everything still outstanding", which is exactly what this
      // endpoint did before it understood partial deliveries — so callers that send no
      // quantity keep their previous behaviour byte for byte.
      const requestedQty = body.qty === undefined || body.qty === null ? null : numOr(body.qty, NaN)
      const resolved = resolveReceiptQty(po, requestedQty)
      if ('error' in resolved) return badRequest(resolved.error)
      const receiptQty = resolved.qty
      const nextStatus = nextPoStatus(po, receiptQty)

      // The note now describes THIS delivery and lands on the receipt row. It used to
      // overwrite the purchase order's own note, destroying the reason the order was
      // raised in the first place.
      const receiptNote = typeof body.note === 'string' && body.note.trim() !== '' ? body.note.trim() : null
      if (receiptNote !== null && receiptNote.length > PO_MAX_NOTE_LENGTH) {
        return badRequest('Note must be 300 characters or less')
      }

      await db.$transaction(async (tx) => {
        // The checks above ran outside the transaction, so a double-click sent two
        // requests that both passed and both incremented stock — the same delivery
        // counted twice. Claiming the row is the guard: the loser writes nothing and
        // aborts before it can add the second increment.
        //
        // The claim pins the exact receivedQty this request read, not merely an upper
        // bound. A bound would refuse over-receipt but still let a stale request write
        // a status computed from what it saw — booking the delivery that completes an
        // order while stamping it PARTIALLY_RECEIVED. Pinning the value makes this a
        // true optimistic lock, the same idiom as updateMedicineWithStockGuard.
        const claimed = await tx.purchaseOrder.updateMany({
          where: {
            id: po.id,
            status: { in: [...RECEIVABLE_PO_STATUSES] },
            receivedQty: receiptClaimReceivedQty(po),
          },
          data: {
            status: nextStatus,
            receivedQty: { increment: receiptQty },
            receivedAt: new Date(),
            receivedById: user.id,
          },
        })
        if (claimed.count === 0) throw new AlreadyReceivedError()

        // Append-only: one row per physical delivery, and the place batch number,
        // expiry and cost per unit will be captured when batch tracking arrives.
        await tx.purchaseOrderReceipt.create({
          data: {
            purchaseOrderId: po.id,
            qty: receiptQty,
            receivedById: user.id,
            note: receiptNote,
          },
        })

        await tx.medicine.update({ where: { id: po.medicineId }, data: { stock: { increment: receiptQty } } })
        await recordStockMovements(tx, [{
          medicineId: po.medicineId,
          delta: receiptQty,
          reason: 'PO_RECEIVE',
          // The delivered quantity, not the ordered one — with partial deliveries those
          // differ, and the ledger has to say what actually arrived.
          note: `PO received — ${receiptQty} × ${po.medicine.name}`,
          userId: user.id,
        }])
        await logAudit(tx, user, {
          action: 'PO_RECEIVE',
          entityType: 'PURCHASE_ORDER',
          entityRef: po.id,
          detail: `Received ${receiptQty} of ${po.qty} × ${po.medicine.name}`,
        })

        // Roll the originating stock request forward, in the same transaction, from
        // quantities derived off the purchase orders — so a request cannot report
        // COMPLETED while a delivery is still outstanding, or vice versa.
        if (po.stockRequestItemId) {
          await refreshRequestProgress(tx, po.stockRequestItemId)
        }
      })
      const fresh = await db.purchaseOrder.findUnique({ where: { id: po.id }, include: poInclude })
      const medicine = await db.medicine.findUnique({ where: { id: po.medicineId }, select: { id: true, stock: true } })
      if (!fresh || !medicine) return notFound('Purchase order not found')
      return Response.json({ order: poToRow(fresh), medicine: { id: medicine.id, stock: medicine.stock } })
    }

    if (action === 'cancel-po') {
      const id = optStr(body.id)
      if (!id) return badRequest('Purchase order id is required')
      const po = await db.purchaseOrder.findUnique({
        where: { id },
        include: { medicine: { select: { name: true } } },
      })
      if (!po) return notFound('Purchase order not found')
      // A partially received order can be cancelled too, and means "the supplier will
      // not send the rest". Without this it could never be closed: it is no longer
      // ORDERED, and it can never reach RECEIVED. Units already booked in stay booked
      // in — they are physically on the shelf, so nothing is restocked or reversed.
      const cancellable: readonly string[] = RECEIVABLE_PO_STATUSES
      if (!cancellable.includes(po.status)) {
        return badRequest('Only open purchase orders can be cancelled')
      }
      // Claimed, not overwritten: cancelling a PO that another request just received
      // would leave the stock increment standing against a CANCELLED order.
      const cancelled = await db.purchaseOrder.updateMany({
        where: { id: po.id, status: { in: [...RECEIVABLE_PO_STATUSES] } },
        data: { status: 'CANCELLED' },
      })
      if (cancelled.count === 0) return badRequest('Only open purchase orders can be cancelled')
      const outstanding = po.qty - po.receivedQty
      await logAudit(db, user, {
        action: 'PO_CANCEL',
        entityType: 'PURCHASE_ORDER',
        entityRef: po.id,
        detail:
          po.receivedQty > 0
            ? `Cancelled ${outstanding} outstanding of ${po.qty} × ${po.medicine.name} (${po.receivedQty} already received)`
            : `Cancelled ${po.qty} × ${po.medicine.name}`,
      })
      const fresh = await db.purchaseOrder.findUnique({ where: { id: po.id }, include: poInclude })
      if (!fresh) return notFound('Purchase order not found')
      return Response.json({ order: poToRow(fresh) })
    }

    if (action === 'create-medicine') {
      const parsed = await buildMedicineData(body.data, 'create')
      if ('error' in parsed) return badRequest(parsed.error)
      const medicine = await db.medicine.create({
        data: parsed.data,
        include: { category: true, extraImages: { orderBy: { sort: 'asc' } } },
      })
      if (medicine.stock > 0) {
        await recordStockMovements(db, [{ medicineId: medicine.id, delta: medicine.stock, reason: 'MANUAL_EDIT', note: 'Initial stock', userId: user.id }])
      }
      return Response.json({ medicine: medicineStaffJson(medicine) }, { status: 201 })
    }

    if (action === 'update-medicine') {
      const id = optStr(body.id)
      if (!id) return badRequest('Medicine id is required')
      const existing = await db.medicine.findUnique({ where: { id } })
      if (!existing) return notFound('Medicine not found')
      const parsed = await buildMedicineData(body.data, 'update')
      if ('error' in parsed) return badRequest(parsed.error)
      // `stock` is an absolute value, so it is only safe to write if it was computed
      // from a current reading. `expectedStock` is what the editor's form was showing;
      // the write lands only if that is still the truth. Absent (an older client, or a
      // caller that only touches other fields) it falls back to the row just read, which
      // still closes the read-then-write window inside this request.
      const expectedStock = body.expectedStock === undefined ? undefined : numOr(body.expectedStock, NaN)
      if (expectedStock !== undefined && !Number.isInteger(expectedStock)) {
        return badRequest('Invalid expected stock')
      }
      const medicine = await updateMedicineWithStockGuard({
        id,
        name: existing.name,
        data: parsed.data,
        previousStock: expectedStock ?? existing.stock,
        actorId: user.id,
      })
      return Response.json({ medicine: medicineStaffJson(medicine) })
    }

    if (action === 'answer' || action === 'reject') {
      const id = optStr(body.id)
      if (!id) return badRequest('Question id is required')
      const existing = await db.question.findUnique({ where: { id } })
      if (!existing) return notFound('Question not found')

      if (action === 'answer') {
        const answer = typeof body.answer === 'string' ? body.answer.trim() : ''
        if (answer.length < 2) return badRequest('Answer must be at least 2 characters')
        if (answer.length > MAX_ANSWER_LENGTH) return badRequest(`Answer must be ${MAX_ANSWER_LENGTH} characters or less`)
        await db.question.update({
          where: { id },
          data: { answer, status: 'ANSWERED', answeredById: user.id, answeredAt: new Date() },
        })
        // Notify the asker so they come back to read the answer (skip on re-answer of same content)
        const medicineName = existing.medicineId
          ? (await db.medicine.findUnique({ where: { id: existing.medicineId }, select: { name: true } }))?.name ?? 'a medicine'
          : 'a medicine'
        await notify(
          existing.userId,
          'Your question was answered',
          `A pharmacist answered your question about ${medicineName}: "${answer.slice(0, 120)}${answer.length > 120 ? '…' : ''}"`
        )
      } else {
        await db.question.update({
          where: { id },
          data: { status: 'REJECTED', answer: null, answeredById: null, answeredAt: null },
        })
      }

      const updated = await db.question.findUnique({ where: { id }, include: questionInclude })
      if (!updated) return notFound('Question not found')
      return Response.json({ question: questionToJson(updated) })
    }

    return badRequest('Invalid action')
  } catch (e) {
    // Lost races are the caller's problem to retry, not server faults.
    if (
      e instanceof AlreadyReviewedError ||
      e instanceof AlreadyReceivedError ||
      e instanceof InsufficientStockError ||
      e instanceof ExpiredMedicineError ||
      e instanceof StockConflictError
    ) {
      return badRequest(e.message)
    }
    return serverError(e)
  }
}
