'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, ClipboardCheck, ClipboardList, Inbox, Plus, RefreshCw, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { fmtDate } from '@/lib/format'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { StockRequestRow, StockRequestStatusValue, StockRequestsData } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import StockRequestDetail from './StockRequestDetail'
import StockRequestForm, { type PrefillLine } from './StockRequestForm'
import { PriorityChip, ProgressBar, REQUEST_STATUS_LABELS, RequestStatusChip } from './stock-request-ui'

type StatusFilter = 'ALL' | 'OPEN' | StockRequestStatusValue

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'OPEN', label: 'Open' },
  { key: 'ALL', label: 'All' },
  { key: 'SUBMITTED', label: 'Awaiting review' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'ORDERED', label: 'Ordered' },
  { key: 'COMPLETED', label: 'Completed' },
]

const CLOSED: StockRequestStatusValue[] = ['COMPLETED', 'CANCELLED', 'REJECTED']

/**
 * The stock request screen, shared by both roles that use it.
 *
 * A request is one document with two readers — the pharmacist who raised it and the
 * admin who decides it — so this is one component with role-dependent affordances
 * rather than two screens that would drift apart. `defaultFilter` is what differs in
 * practice: an admin lands on the review queue, a requester on their own requests.
 */
export default function StockRequests({
  defaultFilter = 'OPEN',
  defaultMine = false,
  onStatsChanged,
}: {
  defaultFilter?: StatusFilter
  defaultMine?: boolean
  onStatsChanged?: () => void
}) {
  const role = useAppStore((s) => s.user?.role)
  const currentUserId = useAppStore((s) => s.user?.id)
  const isAdmin = role === 'ADMIN'

  const [data, setData] = useState<StockRequestsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<StatusFilter>(defaultFilter)
  const [mine, setMine] = useState(defaultMine)
  const [creating, setCreating] = useState(false)
  const [prefill, setPrefill] = useState<PrefillLine[] | undefined>(undefined)
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true)
    else {
      setLoading(true)
      setError(null)
    }
    try {
      const d = await api<StockRequestsData>('/api/stock-requests?resource=list')
      setData(d)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load stock requests'
      if (silent) toast.error(message)
      else setError(message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Memoised because a fresh `[]` on every render would invalidate every useMemo below.
  const requests = useMemo(() => data?.requests ?? [], [data])

  const filtered = useMemo(() => {
    let rows = requests
    if (mine) rows = rows.filter((r) => r.requestedBy.id === currentUserId)
    if (filter === 'OPEN') rows = rows.filter((r) => !CLOSED.includes(r.status))
    else if (filter === 'SUBMITTED') rows = rows.filter((r) => r.status === 'SUBMITTED' || r.status === 'UNDER_REVIEW')
    else if (filter === 'APPROVED') rows = rows.filter((r) => r.status === 'APPROVED' || r.status === 'PARTIALLY_APPROVED')
    else if (filter === 'ORDERED') rows = rows.filter((r) => r.status === 'ORDERED' || r.status === 'PARTIALLY_RECEIVED')
    else if (filter !== 'ALL') rows = rows.filter((r) => r.status === filter)
    return rows
  }, [requests, filter, mine, currentUserId])

  const stats = useMemo(() => {
    const awaiting = requests.filter((r) => r.status === 'SUBMITTED' || r.status === 'UNDER_REVIEW')
    return {
      awaiting: awaiting.length,
      emergency: awaiting.filter((r) => r.priority === 'EMERGENCY').length,
      inFlight: requests.filter((r) => r.status === 'ORDERED' || r.status === 'PARTIALLY_RECEIVED').length,
      unitsOutstanding: requests
        .filter((r) => !CLOSED.includes(r.status))
        .reduce((s, r) => s + r.items.reduce((t, i) => t + i.remainingQty, 0), 0),
    }
  }, [requests])

  const open = openId ? requests.find((r) => r.id === openId) ?? null : null

  function applyUpdate(updated: StockRequestRow) {
    setData((d) =>
      d
        ? { ...d, requests: d.requests.some((r) => r.id === updated.id)
            ? d.requests.map((r) => (r.id === updated.id ? updated : r))
            : [updated, ...d.requests] }
        : d
    )
    onStatsChanged?.()
    // Progress and derived statuses are computed server-side, so refetch quietly
    // rather than trusting a locally patched row to stay in step.
    void load(true)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* stats */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatChip
          label="Awaiting review"
          value={stats.awaiting}
          sub={stats.emergency > 0 ? `${stats.emergency} emergency` : 'nothing urgent'}
          icon={<ClipboardCheck className="size-4" aria-hidden="true" />}
          tone={stats.emergency > 0 ? 'bg-red-100 text-red-700 dark:bg-red-500/15' : 'bg-sky-100 text-sky-700 dark:bg-sky-500/15'}
        />
        <StatChip
          label="On order"
          value={stats.inFlight}
          sub="approved and ordered"
          icon={<ClipboardList className="size-4" aria-hidden="true" />}
          tone="bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15"
        />
        <StatChip
          label="Units outstanding"
          value={stats.unitsOutstanding}
          sub="approved, not yet received"
          icon={<Inbox className="size-4" aria-hidden="true" />}
          tone="bg-teal-100 text-teal-700 dark:bg-teal-500/15"
        />
        <StatChip
          label="Total requests"
          value={requests.length}
          sub={`${requests.filter((r) => r.status === 'COMPLETED').length} completed`}
          icon={<ClipboardList className="size-4" aria-hidden="true" />}
          tone="bg-muted text-muted-foreground"
        />
      </div>

      {/* toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={filter} onValueChange={(v) => setFilter(v as StatusFilter)}>
          <SelectTrigger className="w-full sm:w-[190px]" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTERS.map((f) => (
              <SelectItem key={f.key} value={f.key}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant={mine ? 'default' : 'outline'}
          onClick={() => setMine((m) => !m)}
          className="sm:w-auto"
        >
          Mine only
        </Button>
        <div className="flex gap-2 sm:ml-auto">
          <Button variant="outline" onClick={() => void load(true)} disabled={refreshing}>
            <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} aria-hidden="true" />
            Refresh
          </Button>
          <Button
            onClick={() => {
              setPrefill(undefined)
              setCreating(true)
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            New request
          </Button>
        </div>
      </div>

      {/* table */}
      {error ? (
        <Card className="flex-col items-center gap-2 p-10 text-center">
          <AlertCircle className="size-8 text-muted-foreground/50" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" onClick={() => void load()}>
            Try again
          </Button>
        </Card>
      ) : (
        <Card className="gap-0 py-4">
          <CardContent className="px-4">
            <div className="overflow-x-auto scrollbar-thin">
              <Table className="min-w-[820px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Request</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Raised by</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                    <TableHead className="text-right">Requested</TableHead>
                    <TableHead>Received</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    [...Array(4)].map((_, i) => (
                      <TableRow key={`sk-${i}`}>
                        <TableCell colSpan={8}>
                          <Skeleton className="h-9 w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8}>
                        <div className="flex flex-col items-center gap-2 py-10 text-center">
                          <Inbox className="size-8 text-muted-foreground/50" aria-hidden="true" />
                          <p className="text-sm text-muted-foreground">
                            {requests.length === 0
                              ? 'No stock requests yet. Raise one when inventory runs low.'
                              : 'No requests match these filters.'}
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((r) => {
                      const needsMe = isAdmin && (r.status === 'SUBMITTED' || r.status === 'UNDER_REVIEW')
                      return (
                        <TableRow
                          key={r.id}
                          onClick={() => setOpenId(r.id)}
                          className={cn(
                            'cursor-pointer transition-colors hover:bg-accent/40',
                            r.priority === 'EMERGENCY' && needsMe && 'bg-red-50/60 dark:bg-red-500/5'
                          )}
                        >
                          <TableCell className="font-mono text-xs font-medium">
                            <span className="flex items-center gap-1.5">
                              {r.priority === 'EMERGENCY' && needsMe && (
                                <TriangleAlert className="size-3.5 text-red-600" aria-label="Emergency" />
                              )}
                              {r.requestNo}
                            </span>
                          </TableCell>
                          <TableCell>
                            <PriorityChip priority={r.priority} />
                          </TableCell>
                          <TableCell>
                            <RequestStatusChip status={r.status} />
                          </TableCell>
                          <TableCell className="max-w-36 truncate text-sm text-muted-foreground">
                            {r.requestedBy.name ?? r.requestedBy.email}
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums">{r.itemCount}</TableCell>
                          <TableCell className="text-right text-sm tabular-nums">{r.totalRequested}</TableCell>
                          <TableCell>
                            {r.totalApproved > 0 ? (
                              <ProgressBar received={r.totalReceived} total={r.totalApproved} />
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            {fmtDate(r.createdAt)}
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <StockRequestForm
        open={creating}
        onOpenChange={setCreating}
        prefill={prefill}
        onCreated={applyUpdate}
      />
      <StockRequestDetail
        request={open}
        isAdmin={isAdmin}
        currentUserId={currentUserId}
        onOpenChange={(o) => !o && setOpenId(null)}
        onChanged={applyUpdate}
      />
    </div>
  )
}

function StatChip({
  label,
  value,
  sub,
  icon,
  tone,
}: {
  label: string
  value: string | number
  sub: string
  icon: React.ReactNode
  tone: string
}) {
  return (
    <Card className="gap-1 p-4">
      <div className="flex items-center gap-2">
        <span className={cn('flex size-8 items-center justify-center rounded-lg', tone)}>{icon}</span>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
      </div>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-[11px] text-muted-foreground">{sub}</p>
    </Card>
  )
}

export { REQUEST_STATUS_LABELS }
