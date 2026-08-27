import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requireRole, badRequest, notFound, serverError } from '@/lib/auth'
import { readJson, optStr, numParam, round2, escapeCsv, buildMedicineData, orderInclude, parseOrder, notify, recordStockMovements, type StockMovementEntry } from '../_lib'

const RX_STATUSES = ['PENDING', 'APPROVED', 'REJECTED']
const ORDER_STATUSES = ['PENDING', 'PRESCRIPTION_REVIEW', 'CONFIRMED', 'PROCESSING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'FAILED']
const QA_STATUSES = ['PENDING', 'ANSWERED', 'REJECTED']
/** Same low-stock threshold used by pharmacist stats (lowStockCount / lowStock list). */
const LOW_STOCK_THRESHOLD = 10
const RESTOCK_WINDOW_DAYS = 30
const MAX_ANSWER_LENGTH = 1000

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
  answeredAt: Date | null
  medicine: { id: string; name: string; image: string | null }
  user: { name: string | null; email: string }
  answeredBy: { name: string | null } | null
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
  }
}

const questionInclude = {
  medicine: { select: { id: true, name: true, image: true } },
  user: { select: { name: true, email: true } },
  answeredBy: { select: { name: true } },
} satisfies Prisma.QuestionInclude

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
 * GET /api/pharmacist?resource=stats|prescriptions|medicines|orders|movements|questions|restock-suggestions|export-restock
 */
export async function GET(request: Request) {
  try {
    const user = await requireRole(request, ['PHARMACIST'])
    if (user instanceof Response) return user
    const sp = new URL(request.url).searchParams
    const resource = sp.get('resource') || 'stats'

    if (resource === 'stats') {
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      const in90Days = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
      const [pendingPrescriptions, approvedToday, rejectedToday, totalMedicines, lowStockCount, prescriptionMedicines, lowStock, expiringSoon, expiringSoonCount] =
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
        ])
      return Response.json({
        stats: { pendingPrescriptions, approvedToday, rejectedToday, totalMedicines, lowStockCount, prescriptionMedicines, lowStock, expiringSoon, expiringSoonCount },
      })
    }

    if (resource === 'prescriptions') {
      const status = sp.get('status')
      const where = status && RX_STATUSES.includes(status) ? { status } : {}
      const prescriptions = await db.prescription.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true, phone: true } },
          order: { select: { orderNo: true } },
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
          orderNo: p.order?.orderNo ?? null,
        })),
      })
    }

    if (resource === 'medicines') {
      const search = sp.get('search')?.trim()
      const medicines = await db.medicine.findMany({
        where: search
          ? {
              OR: [
                { name: { contains: search } },
                { genericName: { contains: search } },
                { brand: { contains: search } },
              ],
            }
          : {},
        include: { category: true },
        orderBy: { createdAt: 'desc' },
      })
      return Response.json({ medicines })
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
      return Response.json({ orders: orders.map((o) => parseOrder(o, { prescriptionImage: true })) })
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
 *  {action:'review', prescriptionId, decision:'APPROVED'|'REJECTED', reviewNote?}
 *  {action:'create-medicine', data:{...}}
 *  {action:'update-medicine', id, data:{...}}
 *  {action:'answer', id, answer}   — answer a Q&A question (re-answer allowed, overwrites)
 *  {action:'reject', id}           — reject a Q&A question (answer/answeredBy/answeredAt cleared)
 */
export async function PUT(request: Request) {
  try {
    const user = await requireRole(request, ['PHARMACIST'])
    if (user instanceof Response) return user
    const body = await readJson(request)
    if (!body) return badRequest('Invalid request body')
    const action = optStr(body.action)

    if (action === 'review') {
      const prescriptionId = optStr(body.prescriptionId)
      if (!prescriptionId) return badRequest('Prescription id is required')
      const decision = optStr(body.decision)
      if (decision !== 'APPROVED' && decision !== 'REJECTED') return badRequest('Decision must be APPROVED or REJECTED')

      const prescription = await db.prescription.findUnique({
        where: { id: prescriptionId },
        include: { order: { include: { ...orderInclude, items: { include: { medicine: true } } } } },
      })
      if (!prescription) return notFound('Prescription not found')
      if (prescription.status !== 'PENDING') return badRequest('Already reviewed')

      const reviewNote = optStr(body.reviewNote)?.trim() || null
      const order = prescription.order

      if (decision === 'APPROVED' && order) {
        // Check stock for all Rx order items BEFORE approving
        for (const item of order.items) {
          if (!item.medicine) return badRequest(`Insufficient stock for ${item.name}`)
          if (item.medicine.status !== 'ACTIVE' || item.medicine.stock < item.quantity) {
            return badRequest(`Insufficient stock for ${item.name}`)
          }
        }
        await db.$transaction(async (tx) => {
          await tx.prescription.update({
            where: { id: prescription.id },
            data: { status: 'APPROVED', reviewNote, reviewedById: user.id },
          })
          const movements: StockMovementEntry[] = []
          for (const item of order.items) {
            if (item.medicineId) {
              await tx.medicine.update({ where: { id: item.medicineId }, data: { stock: { decrement: item.quantity } } })
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
        })
      } else if (decision === 'REJECTED' && order) {
        await db.$transaction(async (tx) => {
          await tx.prescription.update({
            where: { id: prescription.id },
            data: { status: 'REJECTED', reviewNote, reviewedById: user.id },
          })
          await tx.order.update({ where: { id: order.id }, data: { status: 'CANCELLED', statusNote: 'Prescription rejected' } })
          await tx.notification.create({
            data: {
              userId: order.userId,
              title: 'Prescription rejected',
              message: `Your prescription was rejected.${reviewNote ? ` Reason: ${reviewNote}` : ''}`,
            },
          })
        })
      } else {
        await db.prescription.update({
          where: { id: prescription.id },
          data: { status: decision, reviewNote, reviewedById: user.id },
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
        include: { order: { select: { orderNo: true } } },
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
          orderNo: updated.order?.orderNo ?? null,
        },
      })
    }

    if (action === 'create-medicine') {
      const parsed = await buildMedicineData(body.data, 'create')
      if ('error' in parsed) return badRequest(parsed.error)
      const medicine = await db.medicine.create({ data: parsed.data, include: { category: true } })
      if (medicine.stock > 0) {
        await recordStockMovements(db, [{ medicineId: medicine.id, delta: medicine.stock, reason: 'MANUAL_EDIT', note: 'Initial stock', userId: user.id }])
      }
      return Response.json({ medicine }, { status: 201 })
    }

    if (action === 'update-medicine') {
      const id = optStr(body.id)
      if (!id) return badRequest('Medicine id is required')
      const existing = await db.medicine.findUnique({ where: { id } })
      if (!existing) return notFound('Medicine not found')
      const parsed = await buildMedicineData(body.data, 'update')
      if ('error' in parsed) return badRequest(parsed.error)
      const newStock = typeof parsed.data.stock === 'number' ? parsed.data.stock : undefined
      const medicine = await db.medicine.update({ where: { id }, data: parsed.data, include: { category: true } })
      if (newStock !== undefined && newStock !== existing.stock) {
        await recordStockMovements(db, [{ medicineId: medicine.id, delta: newStock - existing.stock, reason: 'MANUAL_EDIT', note: 'Manual stock update', userId: user.id }])
      }
      return Response.json({ medicine })
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
    return serverError(e)
  }
}
