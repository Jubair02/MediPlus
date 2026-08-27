'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  FileCheck,
  History,
  LayoutDashboard,
  MessageCircleQuestion,
  PackagePlus,
  Pill,
  ShoppingBag,
  type LucideIcon,
} from 'lucide-react'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { PharmacistStats, QuestionCounts } from '@/lib/types'
import PharmacistOverview from './PharmacistOverview'
import PharmacistPrescriptions from './PharmacistPrescriptions'
import PharmacistQA from './PharmacistQA'
import PharmacistMedicines from './PharmacistMedicines'
import RestockSuggestions from './RestockSuggestions'
import StockLog from './StockLog'
import PharmacistOrders from './PharmacistOrders'

type PharmacistTab =
  | 'overview'
  | 'prescriptions'
  | 'qa'
  | 'medicines'
  | 'restock'
  | 'stocklog'
  | 'orders'

const NAV: { id: PharmacistTab; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'prescriptions', label: 'Prescriptions', icon: FileCheck },
  { id: 'qa', label: 'Q&A', icon: MessageCircleQuestion },
  { id: 'medicines', label: 'Medicines', icon: Pill },
  { id: 'restock', label: 'Restock', icon: PackagePlus },
  { id: 'stocklog', label: 'Stock Log', icon: History },
  { id: 'orders', label: 'Orders', icon: ShoppingBag },
]

const TITLES: Record<PharmacistTab, { title: string; subtitle: string }> = {
  overview: { title: 'Overview', subtitle: 'Your pharmacy desk at a glance' },
  prescriptions: { title: 'Prescriptions', subtitle: 'Review uploaded prescriptions and approve orders' },
  qa: { title: 'Customer questions', subtitle: 'Answer product questions from customers' },
  medicines: { title: 'Medicines', subtitle: 'Catalog, pricing and stock management' },
  restock: { title: 'Restock', subtitle: 'Reorder suggestions from the last 30 days of sales' },
  stocklog: { title: 'Stock Log', subtitle: 'Every stock change with who and why' },
  orders: { title: 'Orders', subtitle: 'Read-only view of incoming orders' },
}

export default function PharmacistDashboard() {
  const user = useAppStore((s) => s.user)
  const setAuthOpen = useAppStore((s) => s.setAuthOpen)
  const [activeTab, setActiveTab] = useState<PharmacistTab>('prescriptions')
  const [stats, setStats] = useState<PharmacistStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [qaCounts, setQaCounts] = useState<QuestionCounts | null>(null)

  const refreshStats = useCallback(async () => {
    setStatsLoading(true)
    try {
      const d = await api<{ stats: PharmacistStats }>('/api/pharmacist?resource=stats')
      setStats(d.stats)
    } catch {
      // silent — overview shows its own empty state
    } finally {
      setStatsLoading(false)
    }
  }, [])

  // Pending-question badge for the Q&A nav item — counts are global in every
  // questions response, so fetching the PENDING page is enough to seed them.
  const refreshQaCounts = useCallback(async () => {
    try {
      const d = await api<{ questions: unknown; counts: QuestionCounts }>(
        '/api/pharmacist?resource=questions&status=PENDING'
      )
      setQaCounts(d.counts)
    } catch {
      // silent — badge simply stays hidden until a fetch succeeds
    }
  }, [])

  useEffect(() => {
    void refreshStats()
    void refreshQaCounts()
  }, [refreshStats, refreshQaCounts])

  // Defensive: dashboards render only for the matching role, but stay safe if user is null
  if (!user) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-muted-foreground">Please sign in to access the pharmacy desk.</p>
        <Button onClick={() => setAuthOpen(true)}>Sign in</Button>
      </div>
    )
  }
  if (user.role !== 'PHARMACIST') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <p className="text-muted-foreground">You do not have permission to view this area.</p>
      </div>
    )
  }

  const pending = stats?.pendingPrescriptions ?? 0
  const pendingQuestions = qaCounts?.PENDING ?? 0
  const meta = TITLES[activeTab]

  const renderBadge = (id: PharmacistTab) => {
    const show = (id === 'prescriptions' && pending > 0) || (id === 'qa' && pendingQuestions > 0)
    if (!show) return null
    return (
      <span
        className={cn(
          'ml-auto rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold text-white'
        )}
      >
        {id === 'qa' ? pendingQuestions : pending}
      </span>
    )
  }

  return (
    <div className="flex min-h-[calc(100vh-64px)] flex-col md:flex-row">
      {/* Desktop sidebar */}
      <aside className="sticky top-[64px] hidden h-[calc(100vh-64px)] w-52 shrink-0 flex-col border-r bg-card p-3 md:flex">
        <p className="px-2 pb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Pharmacy Desk
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
              {renderBadge(item.id)}
            </button>
          ))}
        </nav>
        <div className="mt-auto rounded-lg bg-primary/10 p-3">
          <p className="text-[11px] text-muted-foreground">Pharmacist</p>
          <p className="truncate text-sm font-semibold text-primary">{user.name ?? 'Pharmacist'}</p>
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
            {renderBadge(item.id)}
          </button>
        ))}
      </div>

      {/* Content */}
      <section className="min-w-0 flex-1 p-4 md:p-6">
        <header className="mb-4 md:mb-6">
          <p className="text-xs text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{user.name ?? 'Pharmacist'}</span>
          </p>
          <h1 className="text-xl font-bold tracking-tight md:text-2xl">{meta.title}</h1>
          <p className="text-sm text-muted-foreground">{meta.subtitle}</p>
        </header>

        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
        >
          {activeTab === 'overview' && (
            <PharmacistOverview
              stats={stats}
              loading={statsLoading}
              onGoToPrescriptions={() => setActiveTab('prescriptions')}
              onOpenStockLog={() => setActiveTab('stocklog')}
              onRefresh={() => void refreshStats()}
            />
          )}
          {activeTab === 'prescriptions' && (
            <PharmacistPrescriptions onStatsChanged={() => void refreshStats()} />
          )}
          {activeTab === 'qa' && <PharmacistQA onCountsChanged={setQaCounts} />}
          {activeTab === 'medicines' && <PharmacistMedicines />}
          {activeTab === 'restock' && <RestockSuggestions />}
          {activeTab === 'stocklog' && <StockLog />}
          {activeTab === 'orders' && <PharmacistOrders />}
        </motion.div>
      </section>
    </div>
  )
}
