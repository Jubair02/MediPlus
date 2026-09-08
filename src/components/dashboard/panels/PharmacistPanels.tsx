'use client'

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { PharmacistStats, QuestionCounts } from '@/lib/types'
import type { PanelProps } from '../Dashboard'
import PanelTransition from '../PanelTransition'
import PharmacistOverview from '@/components/pharmacist/PharmacistOverview'
import PharmacistPrescriptions from '@/components/pharmacist/PharmacistPrescriptions'
import PharmacistQA from '@/components/pharmacist/PharmacistQA'
import PharmacistMedicines from '@/components/pharmacist/PharmacistMedicines'
import PurchaseOrders from '@/components/pharmacist/PurchaseOrders'
import RestockSuggestions from '@/components/pharmacist/RestockSuggestions'
import StockLog from '@/components/pharmacist/StockLog'
import StockRequests from '@/components/inventory/StockRequests'
import PharmacistOrders from '@/components/pharmacist/PharmacistOrders'

/**
 * Panel bodies for PHARMACIST, plus the counts behind the sidebar badges.
 *
 * The counts live here rather than in the shell because they are pharmacy figures —
 * pending reviews, open purchase orders, unanswered questions — that no other role has.
 * They reach the sidebar through the shell's `setBadges`, keyed by section id.
 */
export default function PharmacistPanels({ sectionId, goto, setBadges }: PanelProps) {
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

  // Pending-question badge: counts are global in every questions response, so fetching
  // the PENDING page is enough to seed them.
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

  // Republish whenever a figure moves, so the sidebar and the panels never disagree.
  useEffect(() => {
    setBadges({
      'rx:prescriptions': stats?.pendingPrescriptions ?? 0,
      'rx:qa': qaCounts?.PENDING ?? 0,
      'rx:purchase-orders': stats?.openPoCount ?? 0,
    })
  }, [stats, qaCounts, setBadges])

  const body = () => {
    switch (sectionId) {
    case 'rx:overview':
      return (
        <PharmacistOverview
          stats={stats}
          loading={statsLoading}
          onGoToPrescriptions={() => goto('rx:prescriptions')}
          onOpenStockLog={() => goto('rx:stocklog')}
          onRefresh={() => void refreshStats()}
        />
      )
    case 'rx:prescriptions':
      return <PharmacistPrescriptions onStatsChanged={() => void refreshStats()} />
    case 'rx:qa':
      return <PharmacistQA onCountsChanged={setQaCounts} />
    case 'rx:medicines':
      return <PharmacistMedicines />
    case 'rx:stock-requests':
      return <StockRequests defaultFilter="OPEN" onStatsChanged={() => void refreshStats()} />
    case 'rx:restock':
      return <RestockSuggestions onStatsChanged={() => void refreshStats()} />
    case 'rx:purchase-orders':
      return (
        <PurchaseOrders
          onStatsChanged={() => void refreshStats()}
          onGoToRestock={() => goto('rx:restock')}
        />
      )
    case 'rx:stocklog':
      return <StockLog />
    case 'rx:orders':
      return <PharmacistOrders />
    default:
      return null
    }
  }

  return <PanelTransition sectionId={sectionId}>{body()}</PanelTransition>
}
