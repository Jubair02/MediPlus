import { db } from '@/lib/db'
import { requireRole, badRequest, notFound, serverError } from '@/lib/auth'
import { readJson, optStr, buildMedicineData, orderInclude, parseOrder, notify } from '../_lib'

const RX_STATUSES = ['PENDING', 'APPROVED', 'REJECTED']
const ORDER_STATUSES = ['PENDING', 'PRESCRIPTION_REVIEW', 'CONFIRMED', 'PROCESSING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'FAILED']

/**
 * GET /api/pharmacist?resource=stats|prescriptions|medicines|orders
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
          for (const item of order.items) {
            if (item.medicineId) {
              await tx.medicine.update({ where: { id: item.medicineId }, data: { stock: { decrement: item.quantity } } })
            }
          }
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
      return Response.json({ medicine }, { status: 201 })
    }

    if (action === 'update-medicine') {
      const id = optStr(body.id)
      if (!id) return badRequest('Medicine id is required')
      const existing = await db.medicine.findUnique({ where: { id } })
      if (!existing) return notFound('Medicine not found')
      const parsed = await buildMedicineData(body.data, 'update')
      if ('error' in parsed) return badRequest(parsed.error)
      const medicine = await db.medicine.update({ where: { id }, data: parsed.data, include: { category: true } })
      return Response.json({ medicine })
    }

    return badRequest('Invalid action')
  } catch (e) {
    return serverError(e)
  }
}
