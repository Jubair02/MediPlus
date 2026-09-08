import {
  BarChart3,
  BriefcaseMedical,
  ClipboardCheck,
  ClipboardList,
  FileCheck,
  FolderTree,
  History,
  LayoutDashboard,
  MessageCircleQuestion,
  PackagePlus,
  Pill,
  Route,
  ScrollText,
  ShoppingBag,
  Ticket,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import type { Role } from '@/lib/types'

/**
 * Every section of the dashboard, for every role, declared once.
 *
 * There is one dashboard, not three. A role does not get its own shell — it gets the
 * subset of these sections its `roles` list admits. Adding a section to a role is a line
 * here, and the sidebar, the page heading and the panel switch all follow from it.
 *
 * Ids are namespaced by role because several sections share a name across roles
 * ("overview", "orders", "medicines" exist for more than one) while pointing at
 * genuinely different panels. Namespacing keeps a lookup unambiguous even before the
 * list has been filtered.
 */
export interface DashboardSection {
  id: string
  label: string
  icon: LucideIcon
  roles: readonly Role[]
  /** Page heading shown above the panel. */
  title: string
  subtitle: string
  /**
   * Land here when this role opens the dashboard. Separate from sidebar order because
   * they genuinely differ: a pharmacist's first job is the prescription queue, but
   * Overview still reads better at the top of the list. Falls back to the first section.
   */
  landing?: true
}

export const DASHBOARD_SECTIONS: readonly DashboardSection[] = [
  // ---------- admin ----------
  { id: 'admin:overview', label: 'Overview', icon: LayoutDashboard, roles: ['ADMIN'], title: 'Overview', subtitle: 'Store health at a glance' },
  { id: 'admin:orders', label: 'Orders', icon: ShoppingBag, roles: ['ADMIN'], title: 'Orders', subtitle: 'Confirm, assign delivery staff and track every order' },
  { id: 'admin:payments', label: 'Payments', icon: Wallet, roles: ['ADMIN'], title: 'Payments', subtitle: 'Track collections, bKash receipts and refunds' },
  { id: 'admin:medicines', label: 'Medicines', icon: Pill, roles: ['ADMIN'], title: 'Medicines', subtitle: 'Manage the catalog, pricing and stock levels' },
  { id: 'admin:stock-requests', label: 'Stock Requests', icon: ClipboardCheck, roles: ['ADMIN'], title: 'Stock Requests', subtitle: 'Review what the pharmacy has asked for — approval happens before anything is ordered' },
  { id: 'admin:stocklog', label: 'Stock Log', icon: History, roles: ['ADMIN'], title: 'Stock Log', subtitle: 'Every stock change with who and why' },
  { id: 'admin:categories', label: 'Categories', icon: FolderTree, roles: ['ADMIN'], title: 'Categories', subtitle: 'Organize the catalog into departments' },
  { id: 'admin:coupons', label: 'Coupons', icon: Ticket, roles: ['ADMIN'], title: 'Coupons', subtitle: 'Create discount campaigns and track redemptions' },
  { id: 'admin:users', label: 'Users', icon: Users, roles: ['ADMIN'], title: 'Users', subtitle: 'Accounts, roles and access control' },
  { id: 'admin:staff', label: 'Staff', icon: BriefcaseMedical, roles: ['ADMIN'], title: 'Staff', subtitle: 'Pharmacists and delivery personnel' },
  { id: 'admin:reports', label: 'Reports', icon: BarChart3, roles: ['ADMIN'], title: 'Reports', subtitle: 'Sales and performance analytics' },
  { id: 'admin:audit', label: 'Audit Log', icon: ScrollText, roles: ['ADMIN'], title: 'Audit Log', subtitle: 'Every sensitive action, with who did it and when.' },

  // ---------- pharmacist ----------
  { id: 'rx:overview', label: 'Overview', icon: LayoutDashboard, roles: ['PHARMACIST'], title: 'Overview', subtitle: 'Your pharmacy desk at a glance' },
  { id: 'rx:prescriptions', label: 'Prescriptions', icon: FileCheck, roles: ['PHARMACIST'], title: 'Prescriptions', subtitle: 'Review uploaded prescriptions and approve orders', landing: true },
  { id: 'rx:qa', label: 'Q&A', icon: MessageCircleQuestion, roles: ['PHARMACIST'], title: 'Customer questions', subtitle: 'Answer product questions from customers' },
  { id: 'rx:medicines', label: 'Medicines', icon: Pill, roles: ['PHARMACIST'], title: 'Medicines', subtitle: 'Catalog, pricing and stock management' },
  { id: 'rx:stock-requests', label: 'Stock Requests', icon: ClipboardCheck, roles: ['PHARMACIST'], title: 'Stock Requests', subtitle: 'Ask for inventory — an admin approves before any purchase order is raised' },
  { id: 'rx:restock', label: 'Restock', icon: PackagePlus, roles: ['PHARMACIST'], title: 'Restock', subtitle: 'Reorder suggestions from the last 30 days of sales' },
  { id: 'rx:purchase-orders', label: 'Purchase Orders', icon: ClipboardList, roles: ['PHARMACIST'], title: 'Purchase Orders', subtitle: 'Track supplier orders — receiving adds stock automatically.' },
  { id: 'rx:stocklog', label: 'Stock Log', icon: History, roles: ['PHARMACIST'], title: 'Stock Log', subtitle: 'Every stock change with who and why' },
  { id: 'rx:orders', label: 'Orders', icon: ShoppingBag, roles: ['PHARMACIST'], title: 'Orders', subtitle: 'Read-only view of incoming orders' },

  // ---------- delivery ----------
  { id: 'dlv:active', label: 'Active Orders', icon: Route, roles: ['DELIVERY'], title: 'Active orders', subtitle: 'Your assigned deliveries, in the order they should be run' },
  { id: 'dlv:history', label: 'History', icon: Truck, roles: ['DELIVERY'], title: 'Delivery history', subtitle: 'Everything you have completed or reported failed' },
]

/** The sections this role may open, in sidebar order. */
export function sectionsFor(role: Role): DashboardSection[] {
  return DASHBOARD_SECTIONS.filter((s) => s.roles.includes(role))
}

/** Where a role lands when it opens the dashboard. */
export function defaultSectionFor(role: Role): string | null {
  const list = sectionsFor(role)
  return (list.find((s) => s.landing) ?? list[0])?.id ?? null
}

/** May this role open this section? Mirrors the sidebar, and guards a restored id. */
export function canOpenSection(role: Role, id: string): boolean {
  return DASHBOARD_SECTIONS.some((s) => s.id === id && s.roles.includes(role))
}
