'use client'

import { AlertTriangle, CheckCircle2, FileCheck, Pill, RefreshCw, XCircle } from 'lucide-react'
import { fmtBDT } from '@/lib/format'
import type { PharmacistStats } from '@/lib/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

interface PharmacistOverviewProps {
  stats: PharmacistStats | null
  loading: boolean
  onGoToPrescriptions: () => void
  onRefresh: () => void
}

interface StatCardProps {
  icon: typeof Pill
  bgClass: string
  iconClass: string
  label: string
  value: number | string
  hint?: string
}

function StatCard({ icon: Icon, bgClass, iconClass, label, value, hint }: StatCardProps) {
  return (
    <Card className="gap-1.5 p-4 transition-shadow hover:shadow-md">
      <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${bgClass}`}>
        <Icon className={`h-4.5 w-4.5 ${iconClass}`} />
      </div>
      <div>
        <p className="text-2xl font-bold tracking-tight md:text-3xl">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
      {hint && <p className="text-[11px] text-muted-foreground/80">{hint}</p>}
    </Card>
  )
}

export default function PharmacistOverview({
  stats,
  loading,
  onGoToPrescriptions,
  onRefresh,
}: PharmacistOverviewProps) {
  if (loading && !stats) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
    )
  }

  if (!stats) {
    return (
      <Card className="items-center p-10 text-center">
        <AlertTriangle className="h-8 w-8 text-amber-500" />
        <p className="text-sm text-muted-foreground">Could not load pharmacy stats.</p>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </Button>
      </Card>
    )
  }

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Quick actions */}
      <div className="flex flex-wrap gap-2">
        <Button onClick={onGoToPrescriptions}>
          <FileCheck className="h-4 w-4" /> Review queue ({stats.pendingPrescriptions})
        </Button>
        <Button variant="outline" onClick={onRefresh}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <StatCard
          icon={FileCheck}
          bgClass="bg-amber-100"
          iconClass="text-amber-600"
          label="Pending Prescriptions"
          value={stats.pendingPrescriptions}
          hint={stats.pendingPrescriptions > 0 ? 'Needs your review' : 'All caught up'}
        />
        <StatCard
          icon={CheckCircle2}
          bgClass="bg-emerald-100"
          iconClass="text-emerald-700"
          label="Approved Today"
          value={stats.approvedToday}
          hint="Since midnight"
        />
        <StatCard
          icon={XCircle}
          bgClass="bg-red-100"
          iconClass="text-red-600"
          label="Rejected Today"
          value={stats.rejectedToday}
          hint="Since midnight"
        />
        <StatCard
          icon={Pill}
          bgClass="bg-teal-100"
          iconClass="text-teal-700"
          label="Total Medicines"
          value={stats.totalMedicines}
          hint={`${stats.prescriptionMedicines} require Rx`}
        />
        <StatCard
          icon={AlertTriangle}
          bgClass="bg-red-100"
          iconClass="text-red-600"
          label="Low Stock"
          value={stats.lowStockCount}
          hint="Restock recommended"
        />
      </div>

      {/* Low stock alert list */}
      <Card className="p-4">
        <CardHeader className="p-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-red-500" /> Low stock medicines
          </CardTitle>
          <CardDescription>These items are at or below the stock threshold</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {(stats.lowStock ?? []).length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Inventory looks healthy — nothing to restock right now.
            </div>
          ) : (
            <ul className="max-h-96 space-y-2 overflow-y-auto scrollbar-thin">
              {stats.lowStock.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between gap-3 rounded-lg border p-2.5 transition-colors hover:bg-accent/50"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-primary/10">
                      <Pill className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{m.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {m.category?.name ?? 'Uncategorized'} · {fmtBDT(m.price)}
                      </p>
                    </div>
                  </div>
                  {m.stock <= 0 ? (
                    <Badge variant="outline" className="border-red-300 bg-red-100 text-red-800">
                      Out
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-amber-300 bg-amber-100 text-amber-800">
                      Low · {m.stock}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Info */}
      <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900">
        <FileCheck className="h-4 w-4 text-emerald-600" />
        <AlertTitle>Prescription workflow</AlertTitle>
        <AlertDescription>
          Approving a prescription confirms its linked order and deducts stock automatically.
        </AlertDescription>
      </Alert>
    </div>
  )
}
