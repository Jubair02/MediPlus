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
}

export interface NotificationItem {
  id: string
  title: string
  message: string
  read: boolean
  createdAt: string
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
