import { Prisma } from '@prisma/client'
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
  addressFromJson,
  escapeCsv,
  recordStockMovements,
  logAudit,
  type StockMovementEntry,
} from '../_lib'
import { ORDER_STATUS_LABELS, type OrderStatus } from '@/lib/types'

const ORDER_STATUSES = ['PENDING', 'PRESCRIPTION_REVIEW', 'CONFIRMED', 'PROCESSING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'FAILED']
const PAYMENT_STATUSES = ['PENDING', 'PAID', 'FAILED', 'REFUNDED']
const PAYMENT_METHODS = ['COD', 'BKASH_DEMO']
const PAYMENTS_PAGE_SIZE = 20
const ROLES = ['CUSTOMER', 'PHARMACIST', 'ADMIN', 'DELIVERY']
const USER_SELECT = { id: true, name: true, email: true, phone: true, role: true, status: true, createdAt: true, updatedAt: true } as const
/** Round 10 — audit log filter values + page size. */
const AUDIT_ACTIONS = ['PAYMENT_STATUS', 'ORDER_STATUS', 'RX_REVIEW', 'PO_CREATE', 'PO_RECEIVE', 'PO_CANCEL', 'USER_STATUS']
const AUDIT_PAGE_SIZE = 20

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

function csvDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}${m}${day}`
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function csvRow(values: unknown[]): string {
  return values.map(escapeCsv).join(',')
}

// ---------- coupons (validation shared by create / update) ----------

const COUPON_CODE_RE = /^[A-Z0-9_-]{1,20}$/ // trimmed + uppercased before test

interface CouponWriteData {
  code?: string
  type?: string
  value?: number
  minAmount?: number
  maxDiscount?: number | null
  expiresAt?: Date | null
  isActive?: boolean
}

/**
 * Validate a coupon payload. mode 'create' requires code/type/value; mode 'update'
 * validates only the provided fields, using `existing` for cross-field checks
 * (e.g. value ≤ 90 is judged against the row's resulting type).
 */
function parseCouponInput(raw: unknown, mode: 'create'): { error: string } | { data: CouponWriteData & { code: string; type: string; value: number } }
function parseCouponInput(raw: unknown, mode: 'update', existing: { type: string }): { error: string } | { data: CouponWriteData }
function parseCouponInput(
  raw: unknown,
  mode: 'create' | 'update',
  existing?: { type: string } | null
): { error: string } | { data: CouponWriteData } {
  if (typeof raw !== 'object' || raw === null) {
    return { error: mode === 'create' ? 'Coupon data is required' : 'Nothing to update' }
  }
  const d = raw as Record<string, unknown>
  const data: CouponWriteData = {}

  if (d.code !== undefined || mode === 'create') {
    const code = typeof d.code === 'string' ? d.code.trim().toUpperCase() : ''
    if (!code) return { error: 'Coupon code is required' }
    if (!COUPON_CODE_RE.test(code)) return { error: 'Code must be 1-20 characters using A-Z, 0-9, "_" or "-"' }
    data.code = code
  }

  // effective type = provided type, else the row's current type (for cross-field checks on update)
  const effectiveType = d.type !== undefined ? d.type : existing?.type
  if (d.type !== undefined || mode === 'create') {
    if (d.type !== 'PERCENT' && d.type !== 'FIXED') return { error: 'Type must be PERCENT or FIXED' }
    data.type = d.type
  }

  if (d.value !== undefined || mode === 'create') {
    const value = numOr(d.value, NaN)
    if (!Number.isFinite(value) || value <= 0) return { error: 'Value must be greater than 0' }
    if (effectiveType === 'PERCENT' && value > 90) return { error: 'Percent value cannot exceed 90' }
    data.value = round2(value)
  }

  if (d.minAmount !== undefined) {
    const minAmount = numOr(d.minAmount, NaN)
    if (!Number.isFinite(minAmount) || minAmount < 0) return { error: 'Minimum amount must be 0 or greater' }
    data.minAmount = round2(minAmount)
  }

  if (d.maxDiscount !== undefined) {
    if (d.maxDiscount === null || d.maxDiscount === '') {
      data.maxDiscount = null
    } else {
      const maxDiscount = numOr(d.maxDiscount, NaN)
      if (!Number.isFinite(maxDiscount) || maxDiscount <= 0) return { error: 'Max discount must be greater than 0' }
      if (effectiveType !== 'PERCENT') return { error: 'Max discount is only allowed for PERCENT coupons' }
      data.maxDiscount = round2(maxDiscount)
    }
  }

  if (d.expiresAt !== undefined) {
    if (d.expiresAt === null || d.expiresAt === '') {
      data.expiresAt = null
    } else if (typeof d.expiresAt === 'string') {
      const dt = new Date(d.expiresAt)
      if (Number.isNaN(dt.getTime())) return { error: 'Invalid expiry date' }
      const dayStart = new Date(dt)
      dayStart.setHours(0, 0, 0, 0)
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      if (dayStart < todayStart) return { error: 'Expiry date cannot be in the past' }
      data.expiresAt = dt
    } else {
      return { error: 'Invalid expiry date' }
    }
  }

  if (d.isActive !== undefined) {
    if (typeof d.isActive !== 'boolean') return { error: 'isActive must be true or false' }
    data.isActive = d.isActive
  }

  return { data }
}

/** Shared data source for the reports view and the export-report CSV (same shape as GET ?resource=reports). */
async function reportData(days: number) {
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

  return { salesByDay, categorySales, topMedicines, lowStock }
}

/** Shared data source for the delivery performance view and its CSV export (same shape as GET ?resource=delivery-performance). */
async function deliveryPerformance() {
  const staff = await db.user.findMany({
    where: { role: 'DELIVERY' },
    select: { id: true, name: true, email: true, phone: true },
    orderBy: { name: 'asc' },
  })
  const staffIds = staff.map((s) => s.id)
  const orders = staffIds.length
    ? await db.order.findMany({
        where: { deliveryStaffId: { in: staffIds } },
        select: { deliveryStaffId: true, status: true, paymentMethod: true, total: true, createdAt: true, updatedAt: true },
      })
    : []

  const acc = new Map<string, {
    assigned: number
    active: number
    delivered: number
    failed: number
    deliveredValue: number
    codCollected: number
    completionMs: number
    lastDeliveryAt: Date | null
  }>()
  for (const s of staff) {
    acc.set(s.id, { assigned: 0, active: 0, delivered: 0, failed: 0, deliveredValue: 0, codCollected: 0, completionMs: 0, lastDeliveryAt: null })
  }
  for (const o of orders) {
    const entry = o.deliveryStaffId ? acc.get(o.deliveryStaffId) : undefined
    if (!entry) continue
    if (o.status !== 'CANCELLED') entry.assigned += 1
    if (o.status === 'OUT_FOR_DELIVERY') entry.active += 1
    if (o.status === 'FAILED') entry.failed += 1
    if (o.status === 'DELIVERED') {
      entry.delivered += 1
      entry.deliveredValue = round2(entry.deliveredValue + o.total)
      if (o.paymentMethod === 'COD') entry.codCollected = round2(entry.codCollected + o.total)
      entry.completionMs += o.updatedAt.getTime() - o.createdAt.getTime()
      if (!entry.lastDeliveryAt || o.updatedAt > entry.lastDeliveryAt) entry.lastDeliveryAt = o.updatedAt
    }
  }

  return {
    staff: staff
      .map((s) => {
        const e = acc.get(s.id)
        return {
          id: s.id,
          name: s.name,
          email: s.email,
          phone: s.phone,
          assigned: e?.assigned ?? 0,
          active: e?.active ?? 0,
          delivered: e?.delivered ?? 0,
          failed: e?.failed ?? 0,
          deliveredValue: e?.deliveredValue ?? 0,
          codCollected: e?.codCollected ?? 0,
          avgCompletionHours: e && e.delivered > 0 ? round1(e.completionMs / e.delivered / 3_600_000) : null,
          lastDeliveryAt: e?.lastDeliveryAt ? e.lastDeliveryAt.toISOString() : null,
        }
      })
      .sort((a, b) => b.delivered - a.delivered || (a.name ?? '').localeCompare(b.name ?? '')),
  }
}

/** One ledger row per order (newest first): payment info + customer from the user relation. */
interface PaymentLedgerRow {
  orderId: string
  orderNo: string
  customerName: string
  customerEmail: string
  method: string
  status: string
  amount: number
  orderStatus: string
  transactionId: string | null
  paymentId: string | null
  createdAt: Date
}

async function paymentsLedger(): Promise<PaymentLedgerRow[]> {
  const orders = await db.order.findMany({
    include: { payment: true, user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: 'desc' },
  })
  return orders.map((o) => ({
    orderId: o.id,
    orderNo: o.orderNo,
    customerName: o.user?.name ?? 'Customer',
    customerEmail: o.user?.email ?? '',
    method: o.paymentMethod,
    status: o.paymentStatus,
    amount: round2(o.total),
    orderStatus: o.status,
    transactionId: o.payment?.transactionId ?? null,
    paymentId: o.payment?.id ?? null,
    createdAt: o.createdAt,
  }))
}

/** Invalid method/status values are ignored (same convention as the orders resource). */
function filterPayments(rows: PaymentLedgerRow[], method: string | null, status: string | null): PaymentLedgerRow[] {
  return rows.filter(
    (r) =>
      (!method || !PAYMENT_METHODS.includes(method) || r.method === method) &&
      (!status || !PAYMENT_STATUSES.includes(status) || r.status === status)
  )
}

/** Global KPIs — always computed over ALL orders, independent of the method/status filters. */
function paymentsSummary(rows: PaymentLedgerRow[]) {
  let totalCollected = 0
  let codPending = 0
  let bkashTotal = 0
  let refunded = 0
  for (const r of rows) {
    if (r.status === 'PAID') totalCollected += r.amount
    if (r.method === 'COD' && r.status === 'PENDING' && !['CANCELLED', 'FAILED'].includes(r.orderStatus)) codPending += r.amount
    if (r.method === 'BKASH_DEMO' && r.status === 'PAID') bkashTotal += r.amount
    if (r.status === 'REFUNDED') refunded += r.amount
  }
  return {
    totalCollected: round2(totalCollected),
    codPending: round2(codPending),
    bkashTotal: round2(bkashTotal),
    refunded: round2(refunded),
    totalCount: rows.length,
  }
}

/**
 * GET /api/admin?resource=stats|users|medicines|categories|orders|coupons|staff|reports|delivery-performance|payments|payments-export|audit-logs|export-orders|export-medicines|export-users|export-report|export-delivery
 *  audit-logs: ?action=<one of 7 actions or ALL (invalid/ALL ignored)> &search=<actorEmail|actorName|entityRef|detail> &page=<clamped 1..totalPages> (20/page)
 */
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
        totalReviews,
        reviewAgg,
        activeCoupons,
        couponRedemptions,
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
        db.review.count(),
        db.review.aggregate({ _avg: { rating: true } }),
        db.coupon.count({ where: { isActive: true } }),
        db.order.count({ where: { status: notCancelled, couponCode: { not: null } } }),
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
          totalReviews,
          avgRating: reviewAgg._avg.rating == null ? null : round1(reviewAgg._avg.rating),
          activeCoupons,
          couponRedemptions,
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
      const [medicines, reviewGroups] = await Promise.all([
        db.medicine.findMany({
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
        }),
        db.review.groupBy({ by: ['medicineId'], _avg: { rating: true }, _count: { _all: true } }),
      ])
      const ratingByMed = new Map(reviewGroups.map((g) => [g.medicineId, g]))
      return Response.json({
        medicines: medicines.map((m) => {
          const g = ratingByMed.get(m.id)
          return {
            ...m,
            rating: g?._avg.rating != null ? round1(g._avg.rating) : null,
            ratingCount: g?._count._all ?? 0,
          }
        }),
      })
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

    if (resource === 'coupons') {
      const [coupons, usage] = await Promise.all([
        db.coupon.findMany({ orderBy: { createdAt: 'desc' } }),
        // one grouped pass: order count + Σ discount per couponCode over non-cancelled orders
        db.order.groupBy({
          by: ['couponCode'],
          where: { couponCode: { not: null }, status: { not: 'CANCELLED' } },
          _count: { _all: true },
          _sum: { discount: true },
        }),
      ])
      const usageByCode = new Map(usage.map((g) => [g.couponCode as string, g]))
      return Response.json({
        coupons: coupons.map((c) => {
          const u = usageByCode.get(c.code)
          return {
            id: c.id,
            code: c.code,
            type: c.type,
            value: c.value,
            minAmount: c.minAmount,
            maxDiscount: c.maxDiscount,
            isActive: c.isActive,
            expiresAt: c.expiresAt,
            createdAt: c.createdAt,
            usedCount: u?._count._all ?? 0,
            discountAmount: round2(u?._sum.discount ?? 0),
          }
        }),
      })
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
      return Response.json(await reportData(days))
    }

    if (resource === 'export-orders') {
      const orders = await db.order.findMany({ include: orderInclude, orderBy: { createdAt: 'asc' } })
      const header = ['orderNo', 'createdAt', 'customer', 'email', 'city', 'items', 'subtotal', 'discount', 'deliveryFee', 'total', 'paymentMethod', 'paymentStatus', 'status']
      const rows = orders.map((o) =>
        csvRow([
          o.orderNo,
          o.createdAt.toISOString(),
          o.user?.name ?? '',
          o.user?.email ?? '',
          addressFromJson(o.addressJson).city,
          o.items.map((it) => `${it.quantity}x ${it.name}`).join('; '),
          round2(o.subtotal),
          round2(o.discount),
          round2(o.deliveryFee),
          round2(o.total),
          o.paymentMethod,
          o.paymentStatus,
          o.status,
        ])
      )
      return Response.json({ filename: `orders-${csvDate(new Date())}.csv`, csv: [csvRow(header), ...rows].join('\n') })
    }

    if (resource === 'export-medicines') {
      const [medicines, grouped] = await Promise.all([
        db.medicine.findMany({ include: { category: true }, orderBy: { name: 'asc' } }),
        db.review.groupBy({ by: ['medicineId'], _avg: { rating: true }, _count: { _all: true } }),
      ])
      const ratingByMed = new Map(grouped.map((g) => [g.medicineId, g]))
      const header = ['name', 'genericName', 'brand', 'category', 'price', 'discountPrice', 'effectivePrice', 'stock', 'unit', 'requiresPrescription', 'status', 'expiryDate', 'rating', 'ratingCount']
      const rows = medicines.map((m) => {
        const g = ratingByMed.get(m.id)
        return csvRow([
          m.name,
          m.genericName ?? '',
          m.brand ?? '',
          m.category?.name ?? '',
          m.price,
          m.discountPrice ?? '',
          m.discountPrice ?? m.price,
          m.stock,
          m.unit,
          m.requiresPrescription ? 'YES' : 'NO',
          m.status,
          m.expiryDate ? m.expiryDate.toISOString().slice(0, 10) : '',
          g?._avg.rating != null ? round1(g._avg.rating) : '',
          g?._count._all ?? 0,
        ])
      })
      return Response.json({ filename: `medicines-${csvDate(new Date())}.csv`, csv: [csvRow(header), ...rows].join('\n') })
    }

    if (resource === 'export-users') {
      const users = await db.user.findMany({
        select: { ...USER_SELECT, _count: { select: { orders: true } } },
        orderBy: { createdAt: 'asc' },
      })
      const header = ['name', 'email', 'phone', 'role', 'status', 'createdAt', 'ordersCount']
      const rows = users.map((u) =>
        csvRow([
          u.name ?? '',
          u.email,
          u.phone ?? '',
          u.role,
          u.status,
          u.createdAt.toISOString(),
          u._count.orders,
        ])
      )
      return Response.json({ filename: `users-${csvDate(new Date())}.csv`, csv: [csvRow(header), ...rows].join('\n') })
    }

    if (resource === 'export-report') {
      const days = numOr(sp.get('days'), 7) === 30 ? 30 : 7
      const { salesByDay, categorySales, topMedicines, lowStock } = await reportData(days)
      const lines: string[] = []
      lines.push('Sales by day', csvRow(['date', 'orders', 'revenue']))
      for (const s of salesByDay) lines.push(csvRow([s.date, s.orders, s.revenue]))
      lines.push('', 'Sales by category', csvRow(['category', 'qty', 'revenue']))
      for (const c of categorySales) lines.push(csvRow([c.category, c.qty, c.revenue]))
      lines.push('', 'Top medicines', csvRow(['name', 'qty', 'revenue']))
      for (const t of topMedicines) lines.push(csvRow([t.name, t.qty, t.revenue]))
      lines.push('', 'Low stock', csvRow(['name', 'stock', 'price']))
      for (const m of lowStock) lines.push(csvRow([m.name, m.stock, m.discountPrice ?? m.price]))
      return Response.json({ filename: `report-${csvDate(new Date())}.csv`, csv: lines.join('\n') })
    }

    if (resource === 'payments') {
      const all = await paymentsLedger()
      const filtered = filterPayments(all, sp.get('method'), sp.get('status'))
      const total = filtered.length
      const totalPages = Math.max(1, Math.ceil(total / PAYMENTS_PAGE_SIZE))
      const page = Math.min(Math.max(1, numOr(sp.get('page'), 1)), totalPages)
      return Response.json({
        rows: filtered.slice((page - 1) * PAYMENTS_PAGE_SIZE, page * PAYMENTS_PAGE_SIZE),
        summary: paymentsSummary(all),
        page,
        totalPages,
        total,
      })
    }

    if (resource === 'payments-export') {
      const filtered = filterPayments(await paymentsLedger(), sp.get('method'), sp.get('status'))
      const header = ['Order No', 'Customer', 'Method', 'Status', 'Amount', 'Order Status', 'Transaction ID', 'Date']
      const rows = filtered.map((r) =>
        csvRow([
          r.orderNo,
          r.customerName,
          r.method,
          r.status,
          r.amount,
          r.orderStatus,
          r.transactionId ?? '',
          r.createdAt.toISOString(),
        ])
      )
      return Response.json({ filename: `payments-${csvDate(new Date())}.csv`, csv: [csvRow(header), ...rows].join('\n') })
    }

    if (resource === 'audit-logs') {
      const action = sp.get('action')
      const search = sp.get('search')?.trim() ?? ''
      // action must be one of the 7 known values — anything else (incl. 'ALL') is ignored → unfiltered
      const where: Prisma.AuditLogWhereInput = {}
      if (action && AUDIT_ACTIONS.includes(action)) where.action = action
      if (search) {
        where.OR = [
          { actorEmail: { contains: search } },
          { actorName: { contains: search } },
          { entityRef: { contains: search } },
          { detail: { contains: search } },
        ]
      }
      const [total, groups] = await Promise.all([
        db.auditLog.count({ where }),
        // GLOBAL per-action counts — never affected by the action/search filters
        db.auditLog.groupBy({ by: ['action'], _count: { _all: true } }),
      ])
      const byAction = new Map(groups.map((g) => [g.action, g._count._all]))
      const counts = {
        ALL: groups.reduce((s, g) => s + g._count._all, 0),
        PAYMENT_STATUS: byAction.get('PAYMENT_STATUS') ?? 0,
        ORDER_STATUS: byAction.get('ORDER_STATUS') ?? 0,
        RX_REVIEW: byAction.get('RX_REVIEW') ?? 0,
        PO_CREATE: byAction.get('PO_CREATE') ?? 0,
        PO_RECEIVE: byAction.get('PO_RECEIVE') ?? 0,
        PO_CANCEL: byAction.get('PO_CANCEL') ?? 0,
        USER_STATUS: byAction.get('USER_STATUS') ?? 0,
      }
      const totalPages = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE))
      const page = Math.min(Math.max(1, numOr(sp.get('page'), 1)), totalPages)
      const rows = await db.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * AUDIT_PAGE_SIZE,
        take: AUDIT_PAGE_SIZE,
      })
      return Response.json({
        rows: rows.map((r) => ({
          id: r.id,
          actorName: r.actorName,
          actorEmail: r.actorEmail,
          actorRole: r.actorRole,
          action: r.action,
          entityType: r.entityType,
          entityRef: r.entityRef,
          detail: r.detail,
          createdAt: r.createdAt,
        })),
        page,
        totalPages,
        total,
        counts,
      })
    }

    if (resource === 'delivery-performance') {
      return Response.json(await deliveryPerformance())
    }

    if (resource === 'export-delivery') {
      const { staff } = await deliveryPerformance()
      const header = ['name', 'email', 'phone', 'assigned', 'active', 'delivered', 'failed', 'deliveredValue', 'codCollected', 'avgCompletionHours', 'lastDeliveryAt']
      const rows = staff.map((s) =>
        csvRow([
          s.name ?? '',
          s.email,
          s.phone ?? '',
          s.assigned,
          s.active,
          s.delivered,
          s.failed,
          s.deliveredValue,
          s.codCollected,
          s.avgCompletionHours ?? '',
          s.lastDeliveryAt ?? '',
        ])
      )
      return Response.json({ filename: `delivery-${csvDate(new Date())}.csv`, csv: [csvRow(header), ...rows].join('\n') })
    }

    return badRequest('Unknown resource')
  } catch (e) {
    return serverError(e)
  }
}

/**
 * PUT /api/admin
 *  {action:'update-user', id, status?, role?}          — status change writes a USER_STATUS audit entry
 *  {action:'create-medicine'|'update-medicine'|'delete-medicine', ...}
 *  {action:'create-category'|'update-category'|'delete-category', ...}
 *  {action:'update-order', id, status?, deliveryStaffId?} — status change writes an ORDER_STATUS audit entry
 *  {action:'payment-status', orderId, status: PENDING|PAID|FAILED|REFUNDED} — writes a PAYMENT_STATUS audit entry
 *  {action:'create-staff', data:{name,email,password,phone?,role}}
 *  {action:'create-coupon', coupon:{code,type,value,minAmount?,maxDiscount?,expiresAt?,isActive?}}
 *  {action:'update-coupon', id, coupon:{...partial coupon fields}}
 *  {action:'delete-coupon', id}
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
      if (status && status !== target.status) {
        await logAudit(db, user, {
          action: 'USER_STATUS',
          entityType: 'USER',
          entityRef: target.email,
          detail: `User status set to ${status}`,
        })
      }
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

    // ---- coupons ----
    if (action === 'create-coupon') {
      const parsed = parseCouponInput(body.coupon, 'create')
      if ('error' in parsed) return badRequest(parsed.error)
      try {
        const coupon = await db.coupon.create({ data: parsed.data })
        return Response.json({ coupon }, { status: 201 })
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          return badRequest('A coupon with this code already exists')
        }
        throw e
      }
    }

    if (action === 'update-coupon') {
      const id = optStr(body.id)
      if (!id) return badRequest('Coupon id is required')
      const existing = await db.coupon.findUnique({ where: { id } })
      if (!existing) return notFound('Coupon not found')
      const parsed = parseCouponInput(body.coupon, 'update', existing)
      if ('error' in parsed) return badRequest(parsed.error)
      try {
        const coupon = await db.coupon.update({ where: { id }, data: parsed.data })
        return Response.json({ coupon })
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          return badRequest('A coupon with this code already exists')
        }
        throw e
      }
    }

    if (action === 'delete-coupon') {
      const id = optStr(body.id)
      if (!id) return badRequest('Coupon id is required')
      const existing = await db.coupon.findUnique({ where: { id } })
      if (!existing) return notFound('Coupon not found')
      // Orders store couponCode as a plain string (no relation) — safe to delete
      await db.coupon.delete({ where: { id } })
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
            const movements: StockMovementEntry[] = []
            for (const item of order.items) {
              if (item.medicineId) {
                await tx.medicine.update({ where: { id: item.medicineId }, data: { stock: { decrement: item.quantity } } })
                movements.push({
                  medicineId: item.medicineId,
                  delta: -item.quantity,
                  reason: 'ORDER_CONFIRM',
                  note: `Order ${order.orderNo} confirmed`,
                  userId: user.id,
                })
              }
            }
            await recordStockMovements(tx, movements)
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
          const movements: StockMovementEntry[] = []
          await db.$transaction(async (tx) => {
            for (const item of order.items) {
              if (item.medicineId) {
                await tx.medicine.update({ where: { id: item.medicineId }, data: { stock: { increment: item.quantity } } })
                movements.push({
                  medicineId: item.medicineId,
                  delta: item.quantity,
                  reason: 'ORDER_CANCEL',
                  note: `Order ${order.orderNo} cancelled — stock restored`,
                  userId: user.id,
                })
              }
            }
            await recordStockMovements(tx, movements)
          })
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
        await logAudit(db, user, {
          action: 'ORDER_STATUS',
          entityType: 'ORDER',
          entityRef: order.orderNo,
          detail: `Order status set to ${label}`,
        })
      }

      const full = await db.order.findUnique({ where: { id: updated.id }, include: orderInclude })
      if (!full) return notFound('Order not found')
      return Response.json({ order: parseOrder(full, { prescriptionImage: true }) })
    }

    // ---- payments ----
    if (action === 'payment-status') {
      const orderId = optStr(body.orderId)
      const status = optStr(body.status)
      if (!orderId) return badRequest('Order id is required')
      if (!status || !PAYMENT_STATUSES.includes(status)) return badRequest('Invalid payment status')
      const existing = await db.order.findUnique({ where: { id: orderId }, select: { id: true, orderNo: true } })
      if (!existing) return notFound('Order not found')
      await db.$transaction(async (tx) => {
        await tx.order.update({ where: { id: orderId }, data: { paymentStatus: status } })
        const payment = await tx.payment.findUnique({ where: { orderId } })
        if (payment) await tx.payment.update({ where: { id: payment.id }, data: { status } })
        await logAudit(tx, user, {
          action: 'PAYMENT_STATUS',
          entityType: 'PAYMENT',
          entityRef: existing.orderNo,
          detail: `Payment status set to ${status}`,
        })
      })
      const full = await db.order.findUnique({ where: { id: orderId }, include: orderInclude })
      if (!full) return notFound('Order not found')
      return Response.json({ order: parseOrder(full, { prescriptionImage: true }) })
    }

    return badRequest('Invalid action')
  } catch (e) {
    return serverError(e)
  }
}
