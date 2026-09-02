// ---------- Role-based access control: the SINGLE source of truth ----------
// Imported by BOTH the client store/UI and the server route handlers so the two
// layers can never drift. Keep this file isomorphic — no `crypto`, no `@/lib/db`,
// no `next/*` imports, or the client bundle breaks.
import type { Role } from '@/lib/types'

export const ROLES = ['CUSTOMER', 'PHARMACIST', 'ADMIN', 'DELIVERY'] as const

/** Every staff (non-customer) role. */
export const STAFF_ROLES = ['ADMIN', 'PHARMACIST', 'DELIVERY'] as const satisfies readonly Role[]

/** Every role, for views that any signed-in user may open (profile, notifications). */
export const ALL_ROLES = ['CUSTOMER', ...STAFF_ROLES] as const satisfies readonly Role[]

// ---------- views (client-side "pages" of the single-page app) ----------

export type View =
  | 'home'
  | 'catalog'
  | 'cart'
  | 'wishlist'
  | 'checkout'
  | 'orders'
  | 'prescriptions'
  | 'notifications'
  | 'profile'
  | 'admin'
  | 'pharmacist'
  | 'delivery'

/**
 * Which roles may open each view.
 *
 * The storefront views (home/catalog/cart/…) are CUSTOMER-only *for signed-in users*.
 * Guests are handled separately by GUEST_VIEWS: an anonymous visitor must still be able
 * to browse and to land on the sign-in prompt inside cart/orders/etc.
 */
export const VIEW_POLICY: Record<View, readonly Role[]> = {
  home: ['CUSTOMER'],
  catalog: ['CUSTOMER'],
  cart: ['CUSTOMER'],
  wishlist: ['CUSTOMER'],
  checkout: ['CUSTOMER'],
  orders: ['CUSTOMER'],
  prescriptions: ['CUSTOMER'],
  // Profile + notifications are not customer features — every signed-in role owns one.
  notifications: ALL_ROLES,
  profile: ALL_ROLES,
  admin: ['ADMIN'],
  pharmacist: ['PHARMACIST'],
  delivery: ['DELIVERY'],
}

/**
 * Views a signed-out visitor may open. Browsing is public (guests must be able to shop
 * before registering); the account views stay reachable so their existing "Sign in to
 * view your cart" prompt can render instead of a dead end.
 */
export const GUEST_VIEWS: readonly View[] = [
  'home',
  'catalog',
  'cart',
  'wishlist',
  'checkout',
  'orders',
  'prescriptions',
]

/** Dashboard each staff role lands on. CUSTOMER has no dashboard — the storefront is theirs. */
export const ROLE_DASHBOARD: Partial<Record<Role, View>> = {
  ADMIN: 'admin',
  PHARMACIST: 'pharmacist',
  DELIVERY: 'delivery',
}

export const DASHBOARD_LABEL: Partial<Record<Role, string>> = {
  ADMIN: 'Admin dashboard',
  PHARMACIST: 'Pharmacist dashboard',
  DELIVERY: 'Delivery dashboard',
}

export function isStaff(role: Role | null | undefined): boolean {
  return !!role && role !== 'CUSTOMER'
}

export function isCustomer(role: Role | null | undefined): boolean {
  return role === 'CUSTOMER'
}

/** May this role (null = signed out) open this view? */
export function canAccessView(role: Role | null | undefined, view: View): boolean {
  if (!role) return GUEST_VIEWS.includes(view)
  return VIEW_POLICY[view]?.includes(role) ?? false
}

/**
 * Where a role belongs after signing in.
 * CUSTOMER returns null on purpose: customers keep whatever view they were on, so signing
 * in from the cart or mid-checkout resumes that flow instead of bouncing home.
 */
export function landingViewFor(role: Role): View | null {
  return ROLE_DASHBOARD[role] ?? null
}

/** Where to send someone who tried to open a view they may not see. */
export function fallbackViewFor(role: Role | null | undefined): View {
  if (!role) return 'home'
  return ROLE_DASHBOARD[role] ?? 'home'
}
