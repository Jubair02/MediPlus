// Shared helpers for /api route handlers (the ONLY non-route file under src/app/api).
import { Prisma } from '@prisma/client'
import type { User } from '@prisma/client'
import { db } from '@/lib/db'
import { deriveItemProgressStatus, deriveRequestProgressStatus } from '@/lib/stock-request'

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

// ---------- image uploads ----------
//
// Every image in this app arrives as a base64 data URL inside a JSON body and is stored
// verbatim in a text column. Checking only the `data:image` prefix - which is all the
// upload paths used to do - puts no ceiling on any of it: a single request could carry
// tens of megabytes into Postgres, and every later read of that row pays for it again.
// So a data URL is now parsed rather than sniffed: declared type off an allow-list, and
// a decoded size under MAX_IMAGE_BYTES.
//
// Note this bounds one image, not the request. A create-medicine body may legitimately
// carry a primary image plus MAX_EXTRA_IMAGES more, so a total-body limit belongs in
// front of the app (proxy request-body limit), not here.

/** Ceiling on ONE decoded image. The client compresses to ~1400px JPEG, well under this. */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const MAX_IMAGE_LABEL = '2 MB'

/** Raster types the storefront renders. SVG is excluded on purpose: it is script-bearing markup. */
const ALLOWED_IMAGE_TYPES = ['png', 'jpeg', 'jpg', 'webp', 'gif', 'avif']

const DATA_IMAGE_RE = /^data:image\/([a-z0-9.+-]+);base64,([\s\S]*)$/i

/** Decoded byte length of a base64 payload, without allocating the buffer. */
function base64Bytes(payload: string): number {
  const clean = payload.replace(/\s+/g, '')
  if (clean.length === 0) return 0
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding)
}

export interface ImageInputOptions {
  /**
   * Accept a reference as well as a data URL — an http(s) URL, or a site-relative path
   * such as `/images/med-napa.png`. The seeded catalog is entirely relative paths and the
   * medicine form posts the existing value straight back, so refusing them here would
   * make every seeded medicine uneditable.
   */
  allowUrl?: boolean
  /** What to call this in error messages, e.g. 'prescription image'. */
  label?: string
}

/**
 * Validate one uploaded image. Returns the trimmed value on success.
 * Remote URLs (when allowed) pass through unmeasured - there are no bytes to weigh.
 */
export function parseImageInput(raw: unknown, opts: ImageInputOptions = {}): { error: string } | { data: string } {
  const { allowUrl = false, label = 'image' } = opts
  const invalid = { error: `Please upload a valid ${label}` }
  const v = typeof raw === 'string' ? raw.trim() : ''
  if (!v) return invalid
  // `//host/path` is protocol-relative and would resolve off-site, so a bare `/` prefix
  // only counts when the second character is not another slash.
  if (allowUrl && (v.startsWith('http://') || v.startsWith('https://') || (v.startsWith('/') && v[1] !== '/'))) {
    return { data: v }
  }
  const m = DATA_IMAGE_RE.exec(v)
  if (!m) return invalid
  if (!ALLOWED_IMAGE_TYPES.includes(m[1].toLowerCase())) {
    return { error: `Unsupported ${label} format - use JPEG, PNG, WebP, GIF or AVIF` }
  }
  const bytes = base64Bytes(m[2])
  if (bytes === 0) return invalid
  if (bytes > MAX_IMAGE_BYTES) return { error: `${label} must be ${MAX_IMAGE_LABEL} or smaller` }
  return { data: v }
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

// `prescription: true` used to hang off every order query in the app, which meant the
// base64 image column was read for order lists, the delivery board, admin stats and CSV
// exports - hundreds of rows of it - only for parseOrder to throw the image away again.
// The columns the UI actually shows are listed explicitly instead, and the image is an
// opt-in include used by the two single-order reads that render it.
const rxSelect = {
  id: true,
  status: true,
  note: true,
  reviewNote: true,
  createdAt: true,
} satisfies Prisma.PrescriptionSelect

const rxSelectWithImage = { ...rxSelect, image: true } satisfies Prisma.PrescriptionSelect

export const orderInclude = {
  items: true,
  prescription: { select: rxSelect },
  deliveryStaff: { select: { id: true, name: true, phone: true } },
  payment: true,
  user: { select: { id: true, name: true, email: true, phone: true } },
} satisfies Prisma.OrderInclude

/** `orderInclude` plus the prescription image - for a SINGLE order the client displays. */
export const orderIncludeRxImage = {
  ...orderInclude,
  prescription: { select: rxSelectWithImage },
} satisfies Prisma.OrderInclude

export type FullOrder = Prisma.OrderGetPayload<{ include: typeof orderInclude }>
export type FullOrderRxImage = Prisma.OrderGetPayload<{ include: typeof orderIncludeRxImage }>

/**
 * `prescriptionImage: true` only has an effect on an order loaded with
 * `orderIncludeRxImage` - the image simply is not there otherwise, which is the point.
 */
export function parseOrder(order: FullOrder | FullOrderRxImage, opts: { prescriptionImage?: boolean } = {}) {
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
          ...(opts.prescriptionImage && 'image' in rx ? { image: rx.image } : {}),
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

/**
 * Notify every active admin. Until stock requests existed, notifications only ever
 * went to customers about their own orders — nothing told staff that something needed
 * their attention, which is why an EMERGENCY request would otherwise sit unseen until
 * somebody happened to open the right panel.
 *
 * Best-effort by design: a request must not fail to submit because a notification row
 * could not be written, so callers pass the transaction client only when the notice is
 * genuinely part of the unit of work.
 */
export async function notifyAdmins(
  client: Prisma.TransactionClient | typeof db,
  title: string,
  message: string,
  opts: { exceptUserId?: string } = {}
): Promise<void> {
  const admins = await client.user.findMany({
    where: {
      role: 'ADMIN',
      status: 'ACTIVE',
      ...(opts.exceptUserId ? { id: { not: opts.exceptUserId } } : {}),
    },
    select: { id: true },
  })
  if (admins.length === 0) return
  await client.notification.createMany({
    data: admins.map((a) => ({ userId: a.id, title, message })),
  })
}

// ---------- prescription approval expiry (Round 10) ----------

export const RX_VALIDITY_DAYS = 90
export const RX_EXPIRY_WARNING_DAYS = 14

export interface RxExpiryInfo {
  reviewedAt: Date | null
  expiresAt: Date | null
  daysLeft: number | null
  expiringSoon: boolean
}

/**
 * Approval-expiry math for prescriptions — SINGLE SOURCE used by both the pharmacist
 * prescriptions resource and the customer GET /api/prescriptions.
 * An APPROVED prescription is valid for RX_VALIDITY_DAYS days from `reviewedAt`.
 * daysLeft ≤ 0 means expired; expiringSoon includes already-expired rows
 * (daysLeft ≤ RX_EXPIRY_WARNING_DAYS). Non-APPROVED rows / missing reviewedAt → nulls + false.
 */
export function rxExpiryFields(status: string, reviewedAt: Date | null): RxExpiryInfo {
  if (status !== 'APPROVED' || !reviewedAt) {
    return { reviewedAt, expiresAt: null, daysLeft: null, expiringSoon: false }
  }
  const expiresAt = new Date(reviewedAt.getTime() + RX_VALIDITY_DAYS * 24 * 60 * 60 * 1000)
  const daysLeft = Math.ceil((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
  return { reviewedAt, expiresAt, daysLeft, expiringSoon: daysLeft <= RX_EXPIRY_WARNING_DAYS }
}

// ---------- audit log (Round 10) ----------

export interface AuditEntry {
  action: string
  entityType: string
  entityRef: string
  detail?: string | null
}

/**
 * Append an AuditLog row (actor snapshot: id (nullable) + name/email/role).
 * Pass a transaction client (tx) to keep it atomic with the caller's writes, or `db` standalone.
 */
export async function logAudit(
  client: Prisma.TransactionClient | typeof db,
  actor: { id?: string; name?: string | null; email: string; role: string },
  entry: AuditEntry
): Promise<void> {
  await client.auditLog.create({
    data: {
      action: entry.action,
      entityType: entry.entityType,
      entityRef: entry.entityRef,
      detail: entry.detail ?? null,
      actorId: actor.id ?? null,
      actorName: actor.name ?? 'System',
      actorEmail: actor.email,
      actorRole: actor.role,
    },
  })
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

// ---------- medicine gallery (Round 11) ----------

export const MAX_EXTRA_IMAGES = 5
/** Hard ceiling = primary + MAX_EXTRA_IMAGES extras. */
export const MAX_TOTAL_IMAGES = 6

/**
 * Validate the optional `extraImages` key on create/update-medicine (body.data.extraImages).
 * Must be an array when present; each entry a trimmed non-empty string starting with
 * `data:image`, `http://` or `https://`; at most MAX_EXTRA_IMAGES entries.
 * Position errors are 1-based: `Invalid image at position 1` for the first bad entry.
 */
export function parseExtraImages(raw: unknown): { error: string } | { data: string[] } {
  if (raw === undefined) return { data: [] }
  if (!Array.isArray(raw)) return { error: 'Images must be an array' }
  if (raw.length > MAX_EXTRA_IMAGES) return { error: `At most ${MAX_EXTRA_IMAGES} extra images are allowed` }
  const out: string[] = []
  for (let i = 0; i < raw.length; i++) {
    // Size and format are enforced here too - the gallery was the one upload path with
    // no ceiling at all, and it accepts up to MAX_EXTRA_IMAGES of them per request.
    const parsed = parseImageInput(raw[i], { allowUrl: true, label: `image at position ${i + 1}` })
    if ('error' in parsed) return { error: parsed.error }
    out.push(parsed.data)
  }
  return { data: out }
}

/** Public list-row image count: 1 when only the primary, 1 + extras when both, 0 when neither. */
export function medicineImageCount(primaryImage: string | null | undefined, extraCount: number): number {
  return (primaryImage ? 1 : 0) + extraCount
}

/** Medicine row loaded with its extra images (sorted by sort asc) + category. */
export type MedicineWithExtras = Prisma.MedicineGetPayload<{ include: { category: true; extraImages: { orderBy: { sort: 'asc' } } } }>

/**
 * Staff medicine JSON (pharmacist/admin resource=medicines + create/update responses):
 * full row with `extraImages` collapsed to url strings (sorted asc) and `imageCount` (primary + extras).
 */
export function medicineStaffJson(m: MedicineWithExtras) {
  const extraImages = m.extraImages.map((e) => e.url)
  return {
    ...m,
    extraImages,
    imageCount: medicineImageCount(m.image, extraImages.length),
  }
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

  // Round 11 — optional `extraImages` key on body.data (validated via parseExtraImages).
  // create: rows persisted with sort = index. update: key present = REPLACE-ALL (delete + recreate,
  // empty array clears all); key absent = untouched.
  let extraImagesWrite: Record<string, unknown> | undefined
  if (d.extraImages !== undefined) {
    const imgs = parseExtraImages(d.extraImages)
    if ('error' in imgs) return { error: imgs.error }
    extraImagesWrite =
      mode === 'create'
        ? { create: imgs.data.map((url, i) => ({ url, sort: i })) }
        : { deleteMany: {}, create: imgs.data.map((url, i) => ({ url, sort: i })) }
  }

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

  // The primary image is validated, not just trimmed like the other free-text columns:
  // it is an upload, and an unbounded one would land straight in the medicines table.
  if (d.image !== undefined) {
    if (d.image === null || d.image === '') out.image = null
    else {
      const img = parseImageInput(d.image, { allowUrl: true, label: 'medicine image' })
      if ('error' in img) return { error: img.error }
      out.image = img.data
    }
  }

  const nullableText = ['genericName', 'brand', 'manufacturer', 'description'] as const
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

  return {
    data: {
      ...(out as Record<string, unknown>),
      ...(extraImagesWrite ? { extraImages: extraImagesWrite } : {}),
    } as Prisma.MedicineUncheckedCreateInput | Prisma.MedicineUncheckedUpdateInput,
  }
}

/** Raised when a medicine's stock moved between the staff form being loaded and saved. */
export class StockConflictError extends Error {
  constructor(public medicineName: string) {
    super(`Stock for ${medicineName} changed while you were editing — reload and try again`)
    this.name = 'StockConflictError'
  }
}

/**
 * Apply a staff medicine update (pharmacist + admin share this).
 *
 * `stock` is treated as optimistically locked rather than written as an absolute value.
 * A plain `{ stock: 42 }` update silently discards anything that happened in between:
 * an order placed while the edit form was open has its deduction overwritten, so the
 * shop sells units it does not have. The conditional write below only lands if stock is
 * still what the editor saw; otherwise the caller gets a 409-shaped error and can reload.
 *
 * The whole thing is one transaction so the stock movement, the audit trail's only
 * record of a manual adjustment, cannot be left behind by a failed update.
 */
export async function updateMedicineWithStockGuard(args: {
  id: string
  name: string
  data: Prisma.MedicineUncheckedUpdateInput
  previousStock: number
  actorId: string
}): Promise<MedicineWithExtras> {
  const { id, name, data, previousStock, actorId } = args
  const { stock, ...rest } = data
  const nextStock = typeof stock === 'number' ? stock : undefined
  return db.$transaction(async (tx) => {
    if (nextStock !== undefined && nextStock !== previousStock) {
      const claimed = await tx.medicine.updateMany({
        where: { id, stock: previousStock },
        data: { stock: nextStock },
      })
      if (claimed.count === 0) throw new StockConflictError(name)
      await recordStockMovements(tx, [{
        medicineId: id,
        delta: nextStock - previousStock,
        reason: 'MANUAL_EDIT',
        note: 'Manual stock update',
        userId: actorId,
      }])
    }
    return tx.medicine.update({
      where: { id },
      data: rest,
      include: { category: true, extraImages: { orderBy: { sort: 'asc' } } },
    })
  })
}

// ---------- stock movements (audit log) ----------

export interface StockMovementEntry {
  medicineId: string
  delta: number
  reason: string
  note?: string | null
  userId?: string | null
}

/**
 * Roll a stock request forward after a delivery lands against one of its lines.
 *
 * Ordered and received quantities are recomputed from the purchase orders and their
 * receipts rather than read from a counter — nothing here gates a write, so there is
 * no counter to keep in step and nothing to drift. Cancelled purchase orders are
 * excluded: an order the supplier will not fulfil is not outstanding demand.
 *
 * Call inside the receiving transaction, so a request can never report COMPLETED
 * while a delivery is still outstanding, or stay ORDERED after the last one arrives.
 */
export async function refreshRequestProgress(
  client: Prisma.TransactionClient | typeof db,
  stockRequestItemId: string
): Promise<void> {
  const item = await client.stockRequestItem.findUnique({
    where: { id: stockRequestItemId },
    select: { id: true, requestId: true, approvedQty: true },
  })
  if (!item) return

  const siblings = await client.stockRequestItem.findMany({
    where: { requestId: item.requestId },
    select: {
      id: true,
      approvedQty: true,
      purchaseOrders: { select: { qty: true, status: true, receivedQty: true } },
    },
  })

  const progressOf = (s: (typeof siblings)[number]) => {
    const live = s.purchaseOrders.filter((po) => po.status !== 'CANCELLED')
    return {
      approvedQty: s.approvedQty ?? 0,
      orderedQty: live.reduce((t, po) => t + po.qty, 0),
      receivedQty: live.reduce((t, po) => t + po.receivedQty, 0),
    }
  }

  for (const s of siblings) {
    const next = deriveItemProgressStatus(progressOf(s))
    await client.stockRequestItem.update({ where: { id: s.id }, data: { status: next } })
  }

  const req = await client.stockRequest.findUnique({
    where: { id: item.requestId },
    select: { status: true },
  })
  if (!req) return
  const next = deriveRequestProgressStatus(siblings.map(progressOf), req.status)
  if (next !== req.status) {
    await client.stockRequest.update({ where: { id: item.requestId }, data: { status: next } })
  }
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
