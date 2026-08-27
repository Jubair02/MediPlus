// Shared helpers for /api route handlers (the ONLY non-route file under src/app/api).
import { Prisma } from '@prisma/client'
import type { User } from '@prisma/client'
import { db } from '@/lib/db'

// ---------- generic body / query / math helpers ----------

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json()
    if (typeof body === 'object' && body !== null && !Array.isArray(body)) return body as Record<string, unknown>
    return null
  } catch {
    return null
  }
}

export function numParam(v: string | null): number | undefined {
  if (v === null || v.trim() === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export function numOr(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : fallback
}

export function optStr(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

// ---------- users ----------

export function publicUser(u: User) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    status: u.status,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  }
}

// ---------- addresses ----------

export interface ParsedAddress {
  id?: string
  label: string
  recipient: string
  phone: string
  line1: string
  area: string | null
  city: string
  postcode: string | null
  isDefault: boolean
}

export function addressFromJson(json: string): ParsedAddress {
  try {
    const a = JSON.parse(json) as Partial<ParsedAddress>
    return {
      id: typeof a.id === 'string' ? a.id : undefined,
      label: typeof a.label === 'string' ? a.label : 'Home',
      recipient: typeof a.recipient === 'string' ? a.recipient : '',
      phone: typeof a.phone === 'string' ? a.phone : '',
      line1: typeof a.line1 === 'string' ? a.line1 : '',
      area: typeof a.area === 'string' ? a.area : null,
      city: typeof a.city === 'string' ? a.city : '',
      postcode: typeof a.postcode === 'string' ? a.postcode : null,
      isDefault: a.isDefault === true,
    }
  } catch {
    return { label: 'Home', recipient: '', phone: '', line1: '', area: null, city: '', postcode: null, isDefault: false }
  }
}

export function addressToJson(a: ParsedAddress): string {
  return JSON.stringify({
    id: a.id,
    label: a.label,
    recipient: a.recipient,
    phone: a.phone,
    line1: a.line1,
    area: a.area,
    city: a.city,
    postcode: a.postcode,
    isDefault: a.isDefault,
  })
}

export function parseAddressInput(
  raw: unknown,
  missingMsg = 'Delivery address required'
): { error: string } | { data: ParsedAddress } {
  if (typeof raw !== 'object' || raw === null) return { error: missingMsg }
  const a = raw as Record<string, unknown>
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const recipient = s(a.recipient)
  const phone = s(a.phone)
  const line1 = s(a.line1)
  const city = s(a.city)
  if (!recipient || !phone || !line1 || !city) return { error: 'Please fill in recipient, phone, address line and city' }
  return {
    data: {
      label: s(a.label) || 'Home',
      recipient,
      phone,
      line1,
      area: s(a.area) || null,
      city,
      postcode: s(a.postcode) || null,
      isDefault: a.isDefault === true,
    },
  }
}

// ---------- orders ----------

export const orderInclude = {
  items: true,
  prescription: true,
  deliveryStaff: { select: { id: true, name: true, phone: true } },
  payment: true,
  user: { select: { id: true, name: true, email: true, phone: true } },
} satisfies Prisma.OrderInclude

export type FullOrder = Prisma.OrderGetPayload<{ include: typeof orderInclude }>

export function parseOrder(order: FullOrder, opts: { prescriptionImage?: boolean } = {}) {
  const rx = order.prescription
  return {
    id: order.id,
    orderNo: order.orderNo,
    status: order.status,
    items: order.items.map((it) => ({
      id: it.id,
      medicineId: it.medicineId,
      name: it.name,
      price: it.price,
      quantity: it.quantity,
      image: it.image,
      requiresPrescription: it.requiresPrescription,
    })),
    address: addressFromJson(order.addressJson),
    subtotal: order.subtotal,
    discount: order.discount,
    deliveryFee: order.deliveryFee,
    total: order.total,
    couponCode: order.couponCode,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    prescription: rx
      ? {
          id: rx.id,
          status: rx.status,
          note: rx.note,
          reviewNote: rx.reviewNote,
          createdAt: rx.createdAt,
          ...(opts.prescriptionImage ? { image: rx.image } : {}),
        }
      : null,
    deliveryStaff: order.deliveryStaff
      ? { id: order.deliveryStaff.id, name: order.deliveryStaff.name, phone: order.deliveryStaff.phone }
      : null,
    user: order.user,
    statusNote: order.statusNote,
    notes: order.notes,
    payment: order.payment
      ? { id: order.payment.id, method: order.payment.method, status: order.payment.status, amount: order.payment.amount }
      : null,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  }
}

// ---------- notifications ----------

export async function notify(userId: string, title: string, message: string): Promise<void> {
  await db.notification.create({ data: { userId, title, message } })
}

// ---------- coupons ----------

export interface CouponResult {
  code: string
  type: string
  value: number
  discount: number
  maxDiscount: number | null
}

export async function resolveCoupon(rawCode: string, subtotal: number): Promise<{ error: string } | { coupon: CouponResult }> {
  const code = rawCode.trim().toUpperCase()
  if (!code) return { error: 'Invalid coupon code' }
  const c = await db.coupon.findUnique({ where: { code } })
  if (!c || !c.isActive) return { error: 'Invalid coupon code' }
  if (c.expiresAt && c.expiresAt.getTime() < Date.now()) return { error: 'This coupon has expired' }
  if (subtotal < c.minAmount) return { error: `Minimum order ৳${c.minAmount} required` }
  let discount = c.type === 'PERCENT' ? round2((subtotal * c.value) / 100) : c.value
  if (c.type === 'PERCENT' && c.maxDiscount != null) discount = Math.min(discount, c.maxDiscount)
  discount = round2(Math.min(discount, subtotal))
  return { coupon: { code: c.code, type: c.type, value: c.value, discount, maxDiscount: c.maxDiscount } }
}

// ---------- medicines (create / update for pharmacist & admin) ----------

export interface MedicineWriteData {
  name?: string
  genericName?: string | null
  brand?: string | null
  manufacturer?: string | null
  description?: string | null
  categoryId?: string | null
  price?: number
  discountPrice?: number | null
  stock?: number
  unit?: string
  requiresPrescription?: boolean
  expiryDate?: Date | null
  image?: string | null
  status?: string
}

export async function buildMedicineData(raw: unknown, mode: 'create'): Promise<{ error: string } | { data: Prisma.MedicineUncheckedCreateInput }>
export async function buildMedicineData(raw: unknown, mode: 'update'): Promise<{ error: string } | { data: Prisma.MedicineUncheckedUpdateInput }>
export async function buildMedicineData(
  raw: unknown,
  mode: 'create' | 'update'
): Promise<{ error: string } | { data: Prisma.MedicineUncheckedCreateInput | Prisma.MedicineUncheckedUpdateInput }> {
  if (typeof raw !== 'object' || raw === null) {
    return { error: mode === 'create' ? 'Medicine data is required' : 'Nothing to update' }
  }
  const d = raw as Record<string, unknown>
  const out: MedicineWriteData = {}
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : undefined)

  const name = s(d.name)
  if (name !== undefined && name !== '') out.name = name
  if (mode === 'create' && !out.name) return { error: 'Medicine name is required' }

  if (d.price !== undefined) {
    const price = numOr(d.price, NaN)
    if (!Number.isFinite(price) || price <= 0) return { error: 'Price must be greater than 0' }
    out.price = round2(price)
  }
  if (mode === 'create' && out.price === undefined) return { error: 'Price must be greater than 0' }

  if (d.discountPrice !== undefined) {
    if (d.discountPrice === null || d.discountPrice === '') {
      out.discountPrice = null
    } else {
      const dp = numOr(d.discountPrice, NaN)
      if (!Number.isFinite(dp) || dp < 0) return { error: 'Discount price must be a positive number' }
      out.discountPrice = round2(dp)
    }
  }

  if (d.stock !== undefined) {
    const st = Math.round(numOr(d.stock, NaN))
    if (!Number.isFinite(st) || st < 0) return { error: 'Stock must be a non-negative number' }
    out.stock = st
  }

  const nullableText = ['genericName', 'brand', 'manufacturer', 'description', 'image'] as const
  for (const key of nullableText) {
    if (d[key] !== undefined) {
      if (d[key] === null) out[key] = null
      else {
        const v = s(d[key])
        if (v !== undefined) out[key] = v === '' ? null : v
      }
    }
  }

  const unit = s(d.unit)
  if (unit) out.unit = unit

  if (d.requiresPrescription !== undefined) {
    if (typeof d.requiresPrescription === 'boolean') out.requiresPrescription = d.requiresPrescription
    else if (d.requiresPrescription === 'true' || d.requiresPrescription === 1) out.requiresPrescription = true
    else if (d.requiresPrescription === 'false' || d.requiresPrescription === 0) out.requiresPrescription = false
  }

  if (d.categoryId !== undefined) {
    if (d.categoryId === null || d.categoryId === '') out.categoryId = null
    else if (typeof d.categoryId === 'string' && d.categoryId.trim() !== '') {
      const cat = await db.category.findUnique({ where: { id: d.categoryId.trim() } })
      if (!cat) return { error: 'Selected category does not exist' }
      out.categoryId = cat.id
    }
  }

  if (d.status !== undefined) {
    if (d.status === 'ACTIVE' || d.status === 'INACTIVE') out.status = d.status
    else return { error: 'Status must be ACTIVE or INACTIVE' }
  }

  if (d.expiryDate !== undefined) {
    if (d.expiryDate === null || d.expiryDate === '') out.expiryDate = null
    else if (typeof d.expiryDate === 'string') {
      const dt = new Date(d.expiryDate)
      out.expiryDate = Number.isNaN(dt.getTime()) ? null : dt
    }
  }

  return { data: out as Prisma.MedicineUncheckedCreateInput | Prisma.MedicineUncheckedUpdateInput }
}

// ---------- stock movements (audit log) ----------

export interface StockMovementEntry {
  medicineId: string
  delta: number
  reason: string
  note?: string | null
  userId?: string | null
}

/** Create StockMovement audit rows; pass a transaction client (or db) to keep it atomic with the caller. */
export async function recordStockMovements(client: Prisma.TransactionClient, entries: StockMovementEntry[]): Promise<void> {
  if (entries.length === 0) return
  await client.stockMovement.createMany({
    data: entries.map((e) => ({
      medicineId: e.medicineId,
      delta: e.delta,
      reason: e.reason,
      note: e.note ?? null,
      userId: e.userId ?? null,
    })),
  })
}

// ---------- CSV (admin exports) ----------

/** Escape a single CSV field (RFC-4180 style: quote when needed, double inner quotes). */
export function escapeCsv(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// ---------- categories ----------

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'category'
}

export function parseCategoryInput(raw: unknown, mode: 'create' | 'update'): { error: string } | { data: { name?: string; description?: string | null } } {
  if (typeof raw !== 'object' || raw === null) {
    return { error: mode === 'create' ? 'Category data is required' : 'Nothing to update' }
  }
  const d = raw as Record<string, unknown>
  const data: { name?: string; description?: string | null } = {}
  if (d.name !== undefined) {
    if (typeof d.name !== 'string' || d.name.trim() === '') return { error: 'Category name is required' }
    data.name = d.name.trim()
  }
  if (mode === 'create' && !data.name) return { error: 'Category name is required' }
  if (d.description !== undefined) {
    data.description = typeof d.description === 'string' && d.description.trim() !== '' ? d.description.trim() : null
  }
  return { data }
}
