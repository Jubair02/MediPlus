// ---------- Shared types for MediPlus E-Pharmacy ----------

export type Role = 'CUSTOMER' | 'PHARMACIST' | 'ADMIN' | 'DELIVERY'

export interface AuthUser {
  id: string
  name: string | null
  email: string
  phone: string | null
  role: Role
  status: 'ACTIVE' | 'INACTIVE'
  createdAt?: string
}

export interface Category {
  id: string
  name: string
  slug: string
  description?: string | null
  image?: string | null
  medicineCount?: number
}

export interface Medicine {
  id: string
  name: string
  genericName?: string | null
  brand?: string | null
  manufacturer?: string | null
  description?: string | null
  categoryId?: string | null
  category?: Category | null
  price: number
  discountPrice?: number | null
  stock: number
  unit: string
  image?: string | null
  requiresPrescription: boolean
  expiryDate?: string | null
  status: 'ACTIVE' | 'INACTIVE'
  createdAt?: string
  rating?: number | null
  ratingCount?: number
  // Round 11 — list payloads carry a count (badge on cards); detail fetch carries the full array
  imageCount?: number
  images?: string[]
  // Round 11 — staff medicine payloads: additional images beyond the primary (sorted)
  extraImages?: string[]
}

export interface CartItem {
  id: string
  quantity: number
  medicine: Medicine
}

export interface WishlistItem {
  id: string
  medicine: Medicine
}

export interface Prescription {
  id: string
  image: string
  note?: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  reviewNote?: string | null
  createdAt: string
  user?: { id: string; name: string | null; email: string; phone?: string | null } | null
  orderNo?: string | null
  orderId?: string | null
  // Round 10 — approval expiry tracking (APPROVED rows only; null/absent otherwise)
  reviewedAt?: string | null
  expiresAt?: string | null
  daysLeft?: number | null
  expiringSoon?: boolean
}

export interface Review {
  id: string
  rating: number
  comment?: string | null
  createdAt: string
  user?: { id: string; name: string | null } | null
  verified?: boolean
}

export interface ReviewSummary {
  avg: number
  count: number
  distribution: { rating: number; count: number }[]
}

/**
 * Every reason a stock movement can carry, and the single source of truth for them.
 *
 * This list exists because the Stock Log's own filter drifted out of sync with the
 * writers: PO_RECEIVE — the main way stock arrives — was recorded by the receive path
 * but missing from the UI's reason list, so those rows rendered with a raw enum label
 * and could not be filtered for at all. Anything that displays or filters reasons now
 * derives from here, so a new reason cannot go missing again.
 *
 * OPENING is written only by the reconciliation backfill and by the seed; it is the
 * balance a medicine started with, so that SUM(delta) equals stock for every row.
 */
export const STOCK_MOVEMENT_REASONS = [
  'OPENING',
  'PO_RECEIVE',
  'ORDER_CONFIRM',
  'RX_APPROVE',
  'ORDER_CANCEL',
  'MANUAL_EDIT',
  'SEED',
] as const

export type StockMovementReason = (typeof STOCK_MOVEMENT_REASONS)[number]

export interface StockMovementItem {
  id: string
  // Stays a plain string: historic rows may carry a reason no longer in the list
  // above, and the Stock Log must render them rather than crash on them.
  reason: string
  delta: number
  note?: string | null
  createdAt: string
  medicine?: { id: string; name: string; image?: string | null; unit?: string } | null
  user?: { id: string; name: string | null } | null
}

export interface Address {
  id?: string
  label: string
  recipient: string
  phone: string
  line1: string
  area?: string | null
  city: string
  postcode?: string | null
  isDefault?: boolean
}

export interface OrderItem {
  id: string
  name: string
  price: number
  quantity: number
  image?: string | null
  medicineId?: string | null
  requiresPrescription: boolean
}

export type OrderStatus =
  | 'PENDING'
  | 'PRESCRIPTION_REVIEW'
  | 'CONFIRMED'
  | 'PROCESSING'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'FAILED'

export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED'
export type PaymentMethod = 'COD' | 'BKASH_DEMO'

export interface Order {
  id: string
  orderNo: string
  status: OrderStatus
  items: OrderItem[]
  address: Address
  subtotal: number
  discount: number
  deliveryFee: number
  total: number
  couponCode?: string | null
  paymentMethod: PaymentMethod
  paymentStatus: PaymentStatus
  prescription?: Prescription | null
  deliveryStaff?: { id: string; name: string | null; phone: string | null } | null
  statusNote?: string | null
  notes?: string | null
  createdAt: string
  updatedAt: string
  user?: AuthUser | null
}

export interface CouponInfo {
  code: string
  type: 'PERCENT' | 'FIXED'
  value: number
  discount: number
  maxDiscount?: number | null
}

export interface AdminStats {
  totalUsers: number
  totalOrders: number
  totalRevenue: number
  pendingOrders: number
  lowStockCount: number
  pendingPrescriptions: number
  totalMedicines: number
  revenueByDay: { date: string; revenue: number; orders: number }[]
  statusCounts: { status: string; count: number }[]
  topSelling: { name: string; qty: number; revenue: number }[]
  lowStock: Medicine[]
  recentOrders: Order[]
  totalReviews?: number
  avgRating?: number | null
  activeCoupons?: number
  couponRedemptions?: number
}

export interface PharmacistStats {
  pendingPrescriptions: number
  approvedToday: number
  rejectedToday: number
  totalMedicines: number
  lowStockCount: number
  prescriptionMedicines: number
  lowStock: Medicine[]
  expiringSoon: Medicine[]
  expiringSoonCount: number
  // Round 10 (optional — absent in stale responses; always use ?? fallback)
  rxExpiringSoon?: number
  openPoCount?: number
}

export interface NotificationItem {
  id: string
  title: string
  message: string
  read: boolean
  createdAt: string
}

// ---------- Product Q&A (Round 8) ----------

export type QuestionStatus = 'PENDING' | 'ANSWERED' | 'REJECTED'

/** Public per-medicine Q&A row — GET /api/questions?medicineId=<id> */
export interface MedicineQA {
  id: string
  question: string
  answer: string | null
  status: QuestionStatus
  createdAt: string
  answeredAt: string | null
  askedByName: string
  answerByName: string | null
  /** Round 9: number of helpful votes (answered rows only; 0 for pending) */
  helpfulCount?: number
  /** Round 9: whether the caller has voted (only true when a valid token is sent) */
  hasVoted?: boolean
  /** Round 11: caller owns this PENDING question and it is still inside the 15-min edit window */
  canEdit?: boolean
}

/** GET /api/questions?mine=1 — own questions incl. medicine name (all statuses) */
export interface MyQuestion extends MedicineQA {
  medicineId: string
  medicineName: string
}

/** GET /api/pharmacist?resource=questions — pharmacist queue row */
export interface PharmacistQuestion {
  id: string
  question: string
  answer: string | null
  status: QuestionStatus
  createdAt: string
  answeredAt: string | null
  medicineId: string
  medicineName: string
  medicineImage: string | null
  askedByName: string
  askedByEmail: string
  answerByName: string | null
  /** Round 11: question text was edited while PENDING (updatedAt moved >2s past createdAt) */
  edited?: boolean
  /** Round 9: number of helpful votes on this question (0 while pending) */
  helpfulCount?: number
}

export interface QuestionCounts {
  PENDING: number
  ANSWERED: number
  REJECTED: number
}

/** GET /api/pharmacist?resource=restock-suggestions — reorder suggestion row */
export interface RestockSuggestion {
  id: string
  name: string
  brand: string | null
  genericName: string | null
  unit: string
  image: string | null
  stock: number
  lowStockAt: number
  soldLast30: number
  avgDaily: number
  daysLeft: number | null
  suggestedQty: number
  estValue: number
  // Round 10 — total qty across this medicine's OPEN (ORDERED) purchase orders
  openPoQty: number
}

// ---------- Purchase orders (Round 10) ----------

// PARTIALLY_RECEIVED added in Phase 2 alongside PurchaseOrderReceipt: a purchase
// order can now be received across several deliveries. Nothing writes it until the
// receive path learns partial quantities, but the type has to admit it from the
// moment the column can hold it.
export type PurchaseOrderStatus = 'ORDERED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED'

// ---------- Stock requests ----------

export type StockRequestStatusValue =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'PARTIALLY_APPROVED'
  | 'REJECTED'
  | 'ORDERED'
  | 'PARTIALLY_RECEIVED'
  | 'COMPLETED'
  | 'CANCELLED'

export type StockRequestPriorityValue = 'LOW' | 'MEDIUM' | 'HIGH' | 'EMERGENCY'

export type StockRequestItemStatusValue =
  | 'PENDING'
  | 'APPROVED'
  | 'PARTIALLY_APPROVED'
  | 'REJECTED'
  | 'ORDERED'
  | 'PARTIALLY_RECEIVED'
  | 'RECEIVED'
  | 'CANCELLED'

/** One medicine on a stock request. Ordered/received are derived server-side from its POs. */
export interface StockRequestItemRow {
  id: string
  medicine: { id: string; name: string; unit: string; image: string | null; brand: string | null; stock: number }
  /** Stock at the moment the request was raised — a snapshot, not the live figure. */
  stockAtRequest: number
  requestedQty: number
  /** null until reviewed; 0 means reviewed and rejected. */
  approvedQty: number | null
  orderedQty: number
  receivedQty: number
  remainingQty: number
  status: StockRequestItemStatusValue
  note: string | null
  reviewNote: string | null
  purchaseOrders: {
    id: string
    qty: number
    status: PurchaseOrderStatus
    receivedQty: number
    supplier: string | null
    expectedAt: string | null
    orderedAt: string
  }[]
}

export interface StockRequestRow {
  id: string
  requestNo: string
  status: StockRequestStatusValue
  priority: StockRequestPriorityValue
  reason: string | null
  requestedBy: { id: string; name: string | null; email: string }
  reviewedBy: { id: string; name: string | null; email: string } | null
  submittedAt: string | null
  reviewedAt: string | null
  reviewNote: string | null
  expectedAt: string | null
  createdAt: string
  updatedAt: string
  items: StockRequestItemRow[]
  itemCount: number
  totalRequested: number
  totalApproved: number
  totalReceived: number
}

/** GET /api/stock-requests?resource=list */
export interface StockRequestsData {
  requests: StockRequestRow[]
  counts: Partial<Record<StockRequestStatusValue, number>>
  awaitingReview: number
}

/** GET /api/pharmacist?resource=purchase-orders — one row per PO */
export interface PurchaseOrderRow {
  id: string
  qty: number
  /** Units booked in so far, across every delivery against this order. */
  receivedQty: number
  /** qty − receivedQty, never negative. What a receive dialog defaults to and caps at. */
  remainingQty: number
  status: PurchaseOrderStatus
  note: string | null
  supplier: string | null
  expectedAt: string | null
  orderedAt: string
  receivedAt: string | null
  orderedBy: { id: string; name: string | null }
  receivedBy: { id: string; name: string | null } | null
  medicine: { id: string; name: string; unit: string; image: string | null; brand: string | null }
  currentStock: number
}

/** GET /api/pharmacist?resource=purchase-orders — payload */
export interface PurchaseOrdersData {
  orders: PurchaseOrderRow[]
  counts: Record<PurchaseOrderStatus, number>
}

// ---------- Audit log (Round 10) ----------

/**
 * Kept in step with AUDIT_ACTIONS in the admin route (which filters them) and
 * ACTION_FILTERS/ACTION_LABELS/ACTION_TONES in AdminAuditLog (which renders them).
 * All four must list the same values — the audit log's filter is the one place a
 * missing action is invisible until somebody goes looking for a record that is there.
 */
export type AuditAction =
  | 'PAYMENT_STATUS'
  | 'ORDER_STATUS'
  | 'RX_REVIEW'
  | 'SR_CREATE'
  | 'SR_SUBMIT'
  | 'SR_REVIEW'
  | 'SR_CONVERT'
  | 'SR_CANCEL'
  | 'PO_CREATE'
  | 'PO_RECEIVE'
  | 'PO_CANCEL'
  | 'USER_STATUS'
  | 'USER_ROLE'

/** GET /api/admin?resource=audit-logs — one row per audit entry */
export interface AuditLogRow {
  id: string
  actorName: string
  actorEmail: string
  actorRole: string
  action: AuditAction
  entityType: string
  entityRef: string
  detail: string | null
  createdAt: string
}

// ---------- Payments ledger (Round 9) ----------

/** GET /api/admin?resource=payments — one row per order (payment view) */
export interface AdminPaymentRow {
  orderId: string
  orderNo: string
  customerName: string
  customerEmail: string
  method: 'COD' | 'BKASH_DEMO'
  status: PaymentStatus
  amount: number
  orderStatus: OrderStatus
  transactionId: string | null
  paymentId: string | null
  createdAt: string
}

/** Summary block accompanying the payments ledger */
export interface AdminPaymentsSummary {
  totalCollected: number
  codPending: number
  bkashTotal: number
  refunded: number
  totalCount: number
}

export const ORDER_STATUS_FLOW: OrderStatus[] = [
  'PENDING',
  'PRESCRIPTION_REVIEW',
  'CONFIRMED',
  'PROCESSING',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
]

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: 'Pending',
  PRESCRIPTION_REVIEW: 'Prescription Review',
  CONFIRMED: 'Confirmed',
  PROCESSING: 'Processing',
  OUT_FOR_DELIVERY: 'Out for Delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  FAILED: 'Failed Delivery',
}

/**
 * Legal order status transitions, shared by the admin API and the admin UI so the
 * dashboard cannot offer a move the server will reject.
 *
 * The graph exists because stock moves with status: it is decremented once on entry to
 * CONFIRMED and released once when a stock-holding order ends as CANCELLED or FAILED.
 * The three end states are terminal, which is what stops an order being confirmed twice
 * (DELIVERED → PENDING → CONFIRMED) or shipped after its stock was already returned
 * (CANCELLED → CONFIRMED).
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ['PRESCRIPTION_REVIEW', 'CONFIRMED', 'CANCELLED', 'FAILED'],
  PRESCRIPTION_REVIEW: ['CONFIRMED', 'CANCELLED', 'FAILED'],
  CONFIRMED: ['PROCESSING', 'CANCELLED', 'FAILED'],
  PROCESSING: ['OUT_FOR_DELIVERY', 'CANCELLED', 'FAILED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'CANCELLED', 'FAILED'],
  DELIVERED: [],
  CANCELLED: [],
  FAILED: [],
}

/**
 * Legal purchase order status transitions, in the same spirit as ORDER_TRANSITIONS.
 *
 * PARTIALLY_RECEIVED → PARTIALLY_RECEIVED is deliberately legal: the third of five
 * deliveries is a valid move to the same state. Cancelling a partially received order
 * is legal too, and means "the supplier will not send the rest" — the units already
 * booked in stay received, because they are physically on the shelf.
 *
 * Declared here in Phase 2 alongside the schema that permits the new value; the
 * receive path starts enforcing it in Phase 4.
 */
export const PO_TRANSITIONS: Record<PurchaseOrderStatus, readonly PurchaseOrderStatus[]> = {
  ORDERED: ['PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
  PARTIALLY_RECEIVED: ['PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
  RECEIVED: [],
  CANCELLED: [],
}
