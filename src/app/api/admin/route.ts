import { db } from '@/lib/db'
import { requireRole, badRequest, notFound, serverError, hashPassword } from '@/lib/auth'
import {
  readJson,
  optStr,
  numOr,
  round2,
  publicUser,
  buildMedicineData,
  parseCategoryInput,
  slugify,
  orderInclude,
  parseOrder,
  notify,
} from '../_lib'
import { ORDER_STATUS_LABELS, type OrderStatus } from '@/lib/types'

const ORDER_STATUSES = ['PENDING', 'PRESCRIPTION_REVIEW', 'CONFIRMED', 'PROCESSING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'FAILED']
const ROLES = ['CUSTOMER', 'PHARMACIST', 'ADMIN', 'DELIVERY']
const USER_SELECT = { id: true, name: true, email: true, phone: true, role: true, status: true, createdAt: true, updatedAt: true } as const

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

/** GET /api/admin?resource=stats|users|medicines|categories|orders|staff|reports */
export async function GET(request: Request) {
  try {
    const user = await requireRole(request, ['ADMIN'])
    if (user instanceof Response) return user
    const sp = new URL(request.url).searchParams
    const resource = sp.get('resource') || 'stats'

    if (resource === 'stats') {
      const notCancelled = { not: 'CANCELLED' }
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      const weekStart = new Date(todayStart)
      weekStart.setDate(weekStart.getDate() - 6)

      const [
        totalUsers,
        totalOrders,
        revenueAgg,
        pendingOrders,
        lowStockCount,
        pendingPrescriptions,
        totalMedicines,
        weekOrders,
        statusGroups,
        orderItems,
        lowStock,
        recentOrdersRaw,
      ] = await Promise.all([
        db.user.count({ where: { role: 'CUSTOMER' } }),
        db.order.count({ where: { status: notCancelled } }),
        db.order.aggregate({ _sum: { total: true }, where: { status: notCancelled } }),
        db.order.count({ where: { status: { in: ['PENDING', 'PRESCRIPTION_REVIEW'] } } }),
        db.medicine.count({ where: { status: 'ACTIVE', stock: { lte: 10 } } }),
        db.prescription.count({ where: { status: 'PENDING' } }),
        db.medicine.count(),
        db.order.findMany({ where: { status: notCancelled, createdAt: { gte: weekStart } }, select: { createdAt: true, total: true } }),
        db.order.groupBy({ by: ['status'], _count: { _all: true } }),
        db.orderItem.findMany({
          where: { order: { status: notCancelled } },
          select: { name: true, price: true, quantity: true },
        }),
        db.medicine.findMany({
          where: { status: 'ACTIVE', stock: { lte: 10 } },
          include: { category: true },
          orderBy: { stock: 'asc' },
          take: 10,
        }),
        db.order.findMany({ include: orderInclude, orderBy: { createdAt: 'desc' }, take: 8 }),
      ])

      // revenue by day (last 7 days)
      const byDay = new Map<string, { revenue: number; orders: number }>()
      for (let i = 0; i < 7; i++) {
        const d = new Date(weekStart)
        d.setDate(weekStart.getDate() + i)
        byDay.set(dayKey(d), { revenue: 0, orders: 0 })
      }
      for (const o of weekOrders) {
        const entry = byDay.get(dayKey(o.createdAt))
        if (entry) {
          entry.revenue = round2(entry.revenue + o.total)
          entry.orders += 1
        }
      }
      const revenueByDay = Array.from(byDay.entries()).map(([key, v]) => {
        const [y, m, d] = key.split('-').map(Number)
        const date = new Date(y, m - 1, d)
        return { date: `${date.toLocaleDateString('en-US', { weekday: 'short' })} ${d}`, revenue: v.revenue, orders: v.orders }
      })

      // top selling (top 5 by qty)
      const salesMap = new Map<string, { qty: number; revenue: number }>()
      for (const it of orderItems) {
        const entry = salesMap.get(it.name) ?? { qty: 0, revenue: 0 }
        entry.qty += it.quantity
        entry.revenue = round2(entry.revenue + it.price * it.quantity)
        salesMap.set(it.name, entry)
      }
      const topSelling = Array.from(salesMap.entries())
        .map(([name, v]) => ({ name, qty: v.qty, revenue: v.revenue }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 5)

      return Response.json({
        stats: {
          totalUsers,
          totalOrders,
          totalRevenue: round2(revenueAgg._sum.total ?? 0),
          pendingOrders,
          lowStockCount,
          pendingPrescriptions,
          totalMedicines,
          revenueByDay,
          statusCounts: statusGroups.map((g) => ({ status: g.status, count: g._count._all })),
          topSelling,
          lowStock,
          recentOrders: recentOrdersRaw.map((o) => parseOrder(o, { prescriptionImage: true })),
        },
      })
    }

    if (resource === 'users') {
      const search = sp.get('search')?.trim()
      const role = sp.get('role')
      const where: { OR?: object[]; role?: string } = {}
      if (search) where.OR = [{ name: { contains: search } }, { email: { contains: search } }]
      if (role && ROLES.includes(role)) where.role = role
      const users = await db.user.findMany({ where, select: USER_SELECT, orderBy: { createdAt: 'desc' } })
      return Response.json({ users })
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

    if (resource === 'categories') {
      const categories = await db.category.findMany({
        orderBy: { name: 'asc' },
        include: { _count: { select: { medicines: { where: { status: 'ACTIVE' } } } } },
      })
      return Response.json({
        categories: categories.map((c) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          description: c.description,
          image: c.image,
          medicineCount: c._count.medicines,
        })),
      })
    }

    if (resource === 'orders') {
      const status = sp.get('status')
      const search = sp.get('search')?.trim()
      const where: { status?: string; OR?: object[] } = {}
      if (status && ORDER_STATUSES.includes(status)) where.status = status
      if (search) {
        where.OR = [
          { orderNo: { contains: search } },
          { user: { is: { name: { contains: search } } } },
          { user: { is: { email: { contains: search } } } },
        ]
      }
      const orders = await db.order.findMany({ where, include: orderInclude, orderBy: { createdAt: 'desc' } })
      return Response.json({ orders: orders.map((o) => parseOrder(o, { prescriptionImage: true })) })
    }

    if (resource === 'staff') {
      const [pharmacists, deliveryStaff] = await Promise.all([
        db.user.findMany({ where: { role: 'PHARMACIST' }, select: USER_SELECT, orderBy: { createdAt: 'asc' } }),
        db.user.findMany({ where: { role: 'DELIVERY' }, select: USER_SELECT, orderBy: { createdAt: 'asc' } }),
      ])
      return Response.json({ pharmacists, deliveryStaff })
    }

    if (resource === 'reports') {
      const days = numOr(sp.get('days'), 7) === 30 ? 30 : 7
      const notCancelled = { not: 'CANCELLED' }
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      start.setDate(start.getDate() - (days - 1))

      const [orders, orderItems, lowStock] = await Promise.all([
        db.order.findMany({
          where: { status: notCancelled, createdAt: { gte: start } },
          select: { createdAt: true, total: true },
        }),
        db.orderItem.findMany({
          where: { order: { status: notCancelled } },
          select: { name: true, price: true, quantity: true, medicine: { select: { category: { select: { name: true } } } } },
        }),
        db.medicine.findMany({
          where: { status: 'ACTIVE', stock: { lte: 10 } },
          include: { category: true },
          orderBy: { stock: 'asc' },
          take: 10,
        }),
      ])

      const byDay = new Map<string, { revenue: number; orders: number }>()
      for (let i = 0; i < days; i++) {
        const d = new Date(start)
        d.setDate(start.getDate() + i)
        byDay.set(dayKey(d), { revenue: 0, orders: 0 })
      }
      for (const o of orders) {
        const entry = byDay.get(dayKey(o.createdAt))
        if (entry) {
          entry.revenue = round2(entry.revenue + o.total)
          entry.orders += 1
        }
      }
      const salesByDay = Array.from(byDay.entries()).map(([key, v]) => {
        const [y, m, d] = key.split('-').map(Number)
        const date = new Date(y, m - 1, d)
        return {
          date: date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
          revenue: v.revenue,
          orders: v.orders,
        }
      })

      const catMap = new Map<string, { qty: number; revenue: number }>()
      const medMap = new Map<string, { qty: number; revenue: number }>()
      for (const it of orderItems) {
        const revenue = round2(it.price * it.quantity)
        const catName = it.medicine?.category?.name ?? 'Uncategorized'
        const cat = catMap.get(catName) ?? { qty: 0, revenue: 0 }
        cat.qty += it.quantity
        cat.revenue = round2(cat.revenue + revenue)
        catMap.set(catName, cat)
        const med = medMap.get(it.name) ?? { qty: 0, revenue: 0 }
        med.qty += it.quantity
        med.revenue = round2(med.revenue + revenue)
        medMap.set(it.name, med)
      }
      const categorySales = Array.from(catMap.entries())
        .map(([category, v]) => ({ category, qty: v.qty, revenue: v.revenue }))
        .sort((a, b) => b.revenue - a.revenue)
      const topMedicines = Array.from(medMap.entries())
        .map(([name, v]) => ({ name, qty: v.qty, revenue: v.revenue }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 5)

      return Response.json({ salesByDay, categorySales, topMedicines, lowStock })
    }

    return badRequest('Unknown resource')
  } catch (e) {
    return serverError(e)
  }
}

/**
 * PUT /api/admin
 *  {action:'update-user', id, status?, role?}
 *  {action:'create-medicine'|'update-medicine'|'delete-medicine', ...}
 *  {action:'create-category'|'update-category'|'delete-category', ...}
 *  {action:'update-order', id, status?, deliveryStaffId?}
 *  {action:'create-staff', data:{name,email,password,phone?,role}}
 */
export async function PUT(request: Request) {
  try {
    const user = await requireRole(request, ['ADMIN'])
    if (user instanceof Response) return user
    const body = await readJson(request)
    if (!body) return badRequest('Invalid request body')
    const action = optStr(body.action)

    // ---- users ----
    if (action === 'update-user') {
      const id = optStr(body.id)
      if (!id) return badRequest('User id is required')
      const target = await db.user.findUnique({ where: { id } })
      if (!target) return notFound('User not found')
      const status = optStr(body.status)
      const role = optStr(body.role)
      if (status && status !== 'ACTIVE' && status !== 'INACTIVE') return badRequest('Status must be ACTIVE or INACTIVE')
      if (role && !ROLES.includes(role)) return badRequest('Invalid role')
      if (target.id === user.id) {
        if (role && role !== target.role) return badRequest('You cannot change your own role')
        if (status && status !== target.status) return badRequest('You cannot deactivate your own account')
      }
      const updated = await db.user.update({
        where: { id },
        data: {
          ...(status ? { status } : {}),
          ...(role ? { role } : {}),
        },
      })
      return Response.json({ user: publicUser(updated) })
    }

    if (action === 'create-staff') {
      const data = (typeof body.data === 'object' && body.data !== null ? body.data : {}) as Record<string, unknown>
      const name = optStr(data.name)?.trim()
      const email = optStr(data.email)?.trim().toLowerCase()
      const password = optStr(data.password)
      const phone = optStr(data.phone)?.trim()
      const role = optStr(data.role)
      if (!name) return badRequest('Name is required')
      if (!email) return badRequest('Email is required')
      if (!password || password.length < 6) return badRequest('Password must be at least 6 characters')
      if (role !== 'PHARMACIST' && role !== 'DELIVERY') return badRequest('Role must be PHARMACIST or DELIVERY')
      const existing = await db.user.findUnique({ where: { email } })
      if (existing) return badRequest('An account with this email already exists')
      const created = await db.user.create({
        data: { name, email, password: hashPassword(password), phone: phone || null, role, status: 'ACTIVE' },
      })
      return Response.json({ user: publicUser(created) }, { status: 201 })
    }

    // ---- medicines ----
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

    if (action === 'delete-medicine') {
      const id = optStr(body.id)
      if (!id) return badRequest('Medicine id is required')
      const existing = await db.medicine.findUnique({ where: { id } })
      if (!existing) return notFound('Medicine not found')
      await db.medicine.update({ where: { id }, data: { status: 'INACTIVE' } })
      await db.cartItem.deleteMany({ where: { medicineId: id } })
      return Response.json({ ok: true })
    }

    // ---- categories ----
    if (action === 'create-category') {
      const parsed = parseCategoryInput(body.data, 'create')
      if ('error' in parsed) return badRequest(parsed.error)
      const name = parsed.data.name as string
      const existing = await db.category.findFirst({ where: { name } })
      if (existing) return badRequest('A category with this name already exists')
      let slug = slugify(name)
      const slugTaken = await db.category.findUnique({ where: { slug } })
      if (slugTaken) slug = `${slug}-${Date.now().toString(36)}`
      const category = await db.category.create({ data: { name, slug, description: parsed.data.description ?? null } })
      return Response.json({ category }, { status: 201 })
    }

    if (action === 'update-category') {
      const id = optStr(body.id)
      if (!id) return badRequest('Category id is required')
      const existing = await db.category.findUnique({ where: { id } })
      if (!existing) return notFound('Category not found')
      const parsed = parseCategoryInput(body.data, 'update')
      if ('error' in parsed) return badRequest(parsed.error)
      const name = parsed.data.name ?? existing.name
      if (parsed.data.name) {
        const clash = await db.category.findFirst({ where: { name: parsed.data.name, NOT: { id } } })
        if (clash) return badRequest('A category with this name already exists')
      }
      const category = await db.category.update({
        where: { id },
        data: { name, slug: slugify(name), description: parsed.data.description !== undefined ? parsed.data.description : existing.description },
      })
      return Response.json({ category })
    }

    if (action === 'delete-category') {
      const id = optStr(body.id)
      if (!id) return badRequest('Category id is required')
      const existing = await db.category.findUnique({ where: { id } })
      if (!existing) return notFound('Category not found')
      await db.category.delete({ where: { id } })
      return Response.json({ ok: true })
    }

    // ---- orders ----
    if (action === 'update-order') {
      const id = optStr(body.id)
      if (!id) return badRequest('Order id is required')
      const order = await db.order.findUnique({
        where: { id },
        include: { ...orderInclude, items: { include: { medicine: true } } },
      })
      if (!order) return notFound('Order not found')

      const status = optStr(body.status)
      const deliveryStaffId = optStr(body.deliveryStaffId)

      if (status && !ORDER_STATUSES.includes(status)) return badRequest('Invalid status')
      if (deliveryStaffId) {
        const staff = await db.user.findUnique({ where: { id: deliveryStaffId } })
        if (!staff || staff.role !== 'DELIVERY') return badRequest('Selected user is not delivery staff')
      }

      if (status && status !== order.status) {
        if (status === 'CONFIRMED' && ['PENDING', 'PRESCRIPTION_REVIEW'].includes(order.status)) {
          for (const item of order.items) {
            if (!item.medicine || item.medicine.status !== 'ACTIVE' || item.medicine.stock < item.quantity) {
              return badRequest(`Insufficient stock for ${item.name}`)
            }
          }
          await db.$transaction(async (tx) => {
            for (const item of order.items) {
              if (item.medicineId) {
                await tx.medicine.update({ where: { id: item.medicineId }, data: { stock: { decrement: item.quantity } } })
              }
            }
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
          })
        }
        if (status === 'CANCELLED' && ['CONFIRMED', 'PROCESSING', 'OUT_FOR_DELIVERY'].includes(order.status)) {
          for (const item of order.items) {
            if (item.medicineId) {
              await db.medicine.update({ where: { id: item.medicineId }, data: { stock: { increment: item.quantity } } })
            }
          }
        }
        if (status === 'CANCELLED' && order.paymentStatus === 'PAID') {
          if (order.payment) {
            await db.payment.update({ where: { id: order.payment.id }, data: { status: 'REFUNDED' } })
          }
        }
      }

      const wasPaid = order.paymentStatus === 'PAID'
      const updated = await db.order.update({
        where: { id },
        data: {
          ...(status ? { status, statusNote: 'Updated by admin' } : {}),
          ...(status === 'CANCELLED' && wasPaid ? { paymentStatus: 'REFUNDED' } : {}),
          ...(deliveryStaffId ? { deliveryStaffId } : {}),
        },
      })

      if (status && status !== order.status) {
        const label = ORDER_STATUS_LABELS[status as OrderStatus] ?? status
        await notify(order.userId, label, `Order ${order.orderNo} status updated to ${label}.`)
      }

      const full = await db.order.findUnique({ where: { id: updated.id }, include: orderInclude })
      if (!full) return notFound('Order not found')
      return Response.json({ order: parseOrder(full, { prescriptionImage: true }) })
    }

    return badRequest('Invalid action')
  } catch (e) {
    return serverError(e)
  }
}
