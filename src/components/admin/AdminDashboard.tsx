'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  BarChart3,
  BriefcaseMedical,
  FolderTree,
  LayoutDashboard,
  Pill,
  ShoppingBag,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import AdminOverview from './AdminOverview'
import AdminOrders from './AdminOrders'
import AdminMedicines from './AdminMedicines'
import AdminCategories from './AdminCategories'
import AdminUsers from './AdminUsers'
import AdminStaff from './AdminStaff'
import AdminReports from './AdminReports'

type AdminTab =
  | 'overview'
  | 'orders'
  | 'medicines'
  | 'categories'
  | 'users'
  | 'staff'
  | 'reports'

const NAV: { id: AdminTab; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'orders', label: 'Orders', icon: ShoppingBag },
  { id: 'medicines', label: 'Medicines', icon: Pill },
  { id: 'categories', label: 'Categories', icon: FolderTree },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'staff', label: 'Staff', icon: BriefcaseMedical },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
]

const TITLES: Record<AdminTab, { title: string; subtitle: string }> = {
  overview: { title: 'Overview', subtitle: 'Store health at a glance' },
  orders: { title: 'Orders', subtitle: 'Confirm, assign delivery staff and track every order' },
  medicines: { title: 'Medicines', subtitle: 'Manage the catalog, pricing and stock levels' },
  categories: { title: 'Categories', subtitle: 'Organize the catalog into departments' },
  users: { title: 'Users', subtitle: 'Accounts, roles and access control' },
  staff: { title: 'Staff', subtitle: 'Pharmacists and delivery personnel' },
  reports: { title: 'Reports', subtitle: 'Sales and performance analytics' },
}

export default function AdminDashboard() {
  const user = useAppStore((s) => s.user)
  const setAuthOpen = useAppStore((s) => s.setAuthOpen)
  const [activeTab, setActiveTab] = useState<AdminTab>('overview')

  // Defensive: dashboards render only for the matching role, but stay safe if user is null
  if (!user) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-muted-foreground">Please sign in to access the admin dashboard.</p>
        <Button onClick={() => setAuthOpen(true)}>Sign in</Button>
      </div>
    )
  }
  if (user.role !== 'ADMIN') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <p className="text-muted-foreground">You do not have permission to view this area.</p>
      </div>
    )
  }

  const meta = TITLES[activeTab]

  return (
    <div className="flex min-h-[calc(100vh-64px)] flex-col md:flex-row">
      {/* Desktop sidebar */}
      <aside className="sticky top-[64px] hidden h-[calc(100vh-64px)] w-56 shrink-0 flex-col border-r bg-card p-3 md:flex">
        <p className="px-2 pb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Admin Panel
        </p>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
                activeTab === item.id && 'bg-primary/10 font-medium text-primary'
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="mt-auto rounded-lg bg-primary/10 p-3">
          <p className="text-[11px] text-muted-foreground">Signed in as</p>
          <p className="truncate text-sm font-semibold text-primary">{user.name ?? 'Admin'}</p>
          <p className="truncate text-[11px] text-muted-foreground">{user.email}</p>
        </div>
      </aside>

      {/* Mobile segmented nav (horizontal scroll) */}
      <div className="no-scrollbar sticky top-[64px] z-10 flex gap-1.5 overflow-x-auto border-b bg-background/95 p-2 backdrop-blur md:hidden">
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setActiveTab(item.id)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs text-muted-foreground',
              activeTab === item.id && 'border-primary/30 bg-primary/10 font-medium text-primary'
            )}
          >
            <item.icon className="h-3.5 w-3.5" />
            {item.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <section className="min-w-0 flex-1 p-4 md:p-6">
        <header className="mb-4 md:mb-6">
          <h1 className="text-xl font-bold tracking-tight md:text-2xl">{meta.title}</h1>
          <p className="text-sm text-muted-foreground">{meta.subtitle}</p>
        </header>

        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
        >
          {activeTab === 'overview' && <AdminOverview onViewAllOrders={() => setActiveTab('orders')} />}
          {activeTab === 'orders' && <AdminOrders />}
          {activeTab === 'medicines' && <AdminMedicines />}
          {activeTab === 'categories' && <AdminCategories />}
          {activeTab === 'users' && <AdminUsers />}
          {activeTab === 'staff' && <AdminStaff />}
          {activeTab === 'reports' && <AdminReports />}
        </motion.div>
      </section>
    </div>
  )
}
