'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Ban,
  Calendar,
  ClipboardList,
  Loader2,
  PackageCheck,
  PackageSearch,
  RefreshCw,
  Truck,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { PurchaseOrderRow, PurchaseOrderStatus, PurchaseOrdersData } from '@/lib/types'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import MedImage from './MedImage'

type StatusFilter = 'ALL' | PurchaseOrderStatus

/** Parse 'YYYY-MM-DD' (or the date part of an ISO string) as LOCAL midnight. */
function parseDateOnly(value: string): Date {
  const m = /^((\d{4})-(\d{2})-(\d{2}))/.exec(value)
  if (m) return new Date(Number(m[2]), Number(m[3]) - 1, Number(m[4]))
  return new Date(value)
}

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

const STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  ORDERED: 'Ordered',
  PARTIALLY_RECEIVED: 'Part received',
  RECEIVED: 'Received',
  CANCELLED: 'Cancelled',
}

const STATUS_CHIP: Record<PurchaseOrderStatus, string> = {
  ORDERED: 'border-amber-300 bg-amber-100 text-amber-800 dark:text-amber-300',
  // Between ordered and received, and read as such: the same family as RECEIVED,
  // a step short of its confidence.
  PARTIALLY_RECEIVED: 'border-teal-300 bg-teal-100 text-teal-800 dark:text-teal-300',
  RECEIVED: 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:text-emerald-300',
  CANCELLED: 'border-muted bg-muted text-muted-foreground',
}

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'ORDERED', label: 'Ordered' },
  { key: 'PARTIALLY_RECEIVED', label: 'Part received' },
  { key: 'RECEIVED', label: 'Received' },
  { key: 'CANCELLED', label: 'Cancelled' },
]

function StatusChip({ status }: { status: PurchaseOrderStatus }) {
  return (
    <Badge variant="outline" className={cn('border whitespace-nowrap', STATUS_CHIP[status])}>
      {STATUS_LABELS[status]}
    </Badge>
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

function PurchaseOrdersSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-[86px] rounded-xl" />
        ))}
      </div>
      <Card className="gap-0 py-4">
        <CardContent className="px-4">
          <div className="overflow-x-auto rounded-md border scrollbar-thin">
            <Table className="min-w-[860px]">
              <TableHeader>
                <TableRow>
                  {[...Array(7)].map((_, i) => (
                    <TableHead key={i}>
                      <Skeleton className="h-4 w-16" />
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...Array(3)].map((_, i) => (
                  <TableRow key={`sk-${i}`}>
                    <TableCell colSpan={7}>
                      <Skeleton className="h-10 w-full" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/** Dashed-card empty state (Round 9 CartView pattern). */
function EmptyState({
  icon,
  title,
  subtitle,
  action,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  action?: React.ReactNode
}) {
  return (
    <div className="mx-auto max-w-md py-16">
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-8 text-center">
        <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {icon}
        </span>
        <div>
          <p className="font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {action}
      </div>
    </div>
  )
}

interface PurchaseOrdersProps {
  /** Notify the dashboard so nav badges/stats stay in sync after mutations. */
  onStatsChanged?: () => void
  /** Optional jump to the Restock tab (used by the empty state). */
  onGoToRestock?: () => void
}

export default function PurchaseOrders({ onStatsChanged, onGoToRestock }: PurchaseOrdersProps) {
  const [data, setData] = useState<PurchaseOrdersData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<StatusFilter>('ALL')
  const [receiveTarget, setReceiveTarget] = useState<PurchaseOrderRow | null>(null)
  const [cancelTarget, setCancelTarget] = useState<PurchaseOrderRow | null>(null)
  const [actingId, setActingId] = useState<string | null>(null)

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true)
    else {
      setLoading(true)
      setError(null)
    }
    try {
      const d = await api<PurchaseOrdersData>('/api/pharmacist?resource=purchase-orders')
      setData(d)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load purchase orders'
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

  const orders = data?.orders ?? []
  const counts = data?.counts ?? { ORDERED: 0, RECEIVED: 0, CANCELLED: 0 }
  const todayStart = startOfToday()

  const unitsOnOrder = useMemo(
    () =>
      orders
        .filter((o) => o.status === 'ORDERED')
        .reduce((sum, o) => sum + o.qty, 0),
    [orders]
  )

  const filtered = useMemo(
    () => (filter === 'ALL' ? orders : orders.filter((o) => o.status === filter)),
    [orders, filter]
  )

  async function receive(row: PurchaseOrderRow) {
    setActingId(row.id)
    try {
      const d = await api<{ order: PurchaseOrderRow; medicine: { id: string; stock: number } }>(
        '/api/pharmacist',
        { method: 'PUT', body: { action: 'receive-po', id: row.id } }
      )
      toast.success(`Received ${row.qty} × ${row.medicine.name} — stock now ${d.medicine.stock}`)
      setReceiveTarget(null)
      onStatsChanged?.()
      await load(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to receive purchase order')
    } finally {
      setActingId(null)
    }
  }

  async function cancelOrder(row: PurchaseOrderRow) {
    setActingId(row.id)
    try {
      await api<{ order: PurchaseOrderRow }>('/api/pharmacist', {
        method: 'PUT',
        body: { action: 'cancel-po', id: row.id },
      })
      toast.success(`Cancelled ${row.qty} × ${row.medicine.name}`)
      setCancelTarget(null)
      onStatsChanged?.()
      await load(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to cancel purchase order')
    } finally {
      setActingId(null)
    }
  }

  const busyDialog = actingId !== null

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Receiving an order adds its units to stock automatically.
        </p>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => void load(true)}
          disabled={refreshing}
          title="Refresh purchase orders"
          aria-label="Refresh purchase orders"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
        </Button>
      </div>

      {error ? (
        <Card className="flex-col items-center gap-2 p-10 text-center">
          <PackageSearch className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </Button>
        </Card>
      ) : loading && !data ? (
        <PurchaseOrdersSkeleton />
      ) : orders.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="size-5" aria-hidden="true" />}
          title="No purchase orders yet"
          subtitle="Mark restock suggestions as ordered to create your first PO."
          action={
            onGoToRestock ? (
              <Button size="sm" onClick={onGoToRestock}>
                <PackageSearch className="h-4 w-4" /> Go to Restock
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Summary strip */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatChip
              label="Open"
              value={counts.ORDERED}
              sub="awaiting delivery"
              tone="bg-amber-100"
              icon={<ClipboardList className="size-4 text-amber-700" aria-hidden="true" />}
            />
            <StatChip
              label="Units on order"
              value={unitsOnOrder}
              sub="across open orders"
              tone="bg-primary/10"
              icon={<PackageSearch className="text-primary size-4" aria-hidden="true" />}
            />
            <StatChip
              label="Received"
              value={counts.RECEIVED}
              sub="all time"
              tone="bg-emerald-100"
              icon={<PackageCheck className="size-4 text-emerald-700" aria-hidden="true" />}
            />
            <StatChip
              label="Cancelled"
              value={counts.CANCELLED}
              sub="all time"
              tone="bg-muted"
              icon={<Ban className="size-4 text-muted-foreground" aria-hidden="true" />}
            />
          </div>

          {/* Status filter row */}
          <div
            role="radiogroup"
            aria-label="Filter purchase orders by status"
            className="flex flex-wrap items-center gap-1.5"
          >
            {FILTERS.map((f) => {
              const active = filter === f.key
              const n =
                f.key === 'ALL'
                  ? orders.length
                  : f.key === 'ORDERED'
                    ? counts.ORDERED
                    : f.key === 'RECEIVED'
                      ? counts.RECEIVED
                      : counts.CANCELLED
              return (
                <Button
                  key={f.key}
                  size="sm"
                  variant={active ? 'secondary' : 'ghost'}
                  aria-pressed={active}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    'h-8 rounded-full px-3 text-xs focus-visible:ring-primary/30',
                    !active && 'text-muted-foreground'
                  )}
                >
                  {f.label}
                  <span
                    className={cn(
                      'ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                      active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {n}
                  </span>
                </Button>
              )
            })}
          </div>

          {/* Orders table */}
          <Card className="gap-0 py-4">
            <CardContent className="px-4">
              {filtered.length === 0 ? (
                <EmptyState
                  icon={<PackageSearch className="size-5 text-muted-foreground/70" aria-hidden="true" />}
                  title={`No ${filter === 'ORDERED' ? 'ordered' : filter === 'RECEIVED' ? 'received' : 'cancelled'} purchase orders`}
                  subtitle="Try a different status filter."
                />
              ) : (
                <div className="max-h-[60vh] overflow-auto rounded-md border scrollbar-thin">
                  <Table className="min-w-[860px]" aria-label="Purchase orders">
                    <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_var(--border)]">
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Medicine</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-center">Status</TableHead>
                        <TableHead>Ordered</TableHead>
                        <TableHead>Received</TableHead>
                        <TableHead>Details</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((o) => {
                        const isOrdered = o.status === 'ORDERED'
                        const acting = actingId === o.id
                        const expected = o.expectedAt ? parseDateOnly(o.expectedAt) : null
                        const overdue =
                          isOrdered && expected !== null && expected.getTime() < todayStart.getTime()
                        const hasDetails = Boolean(o.expectedAt || o.supplier || o.note)
                        return (
                          <TableRow key={o.id} className="transition-colors hover:bg-accent/40">
                            <TableCell>
                              <div className="flex items-center gap-2.5">
                                <MedImage
                                  src={o.medicine.image}
                                  alt={o.medicine.name}
                                  className="h-9 w-9 shrink-0 rounded-md border object-cover"
                                />
                                <div className="min-w-0">
                                  <p
                                    className="max-w-40 truncate text-sm font-medium"
                                    title={o.medicine.name}
                                  >
                                    {o.medicine.name}
                                  </p>
                                  <p className="max-w-52 truncate text-xs text-muted-foreground">
                                    {[o.medicine.brand, o.medicine.unit].filter(Boolean).join(' · ') ||
                                      '—'}
                                  </p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-right">
                              <span className="text-sm font-bold tabular-nums">{o.qty}</span>
                              <span className="ml-1 text-xs text-muted-foreground">
                                {o.medicine.unit}
                              </span>
                            </TableCell>
                            <TableCell className="text-center">
                              <StatusChip status={o.status} />
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              <p className="max-w-32 truncate text-sm">{o.orderedBy?.name ?? '—'}</p>
                              <p className="text-xs text-muted-foreground tabular-nums">
                                {fmtDateTime(o.orderedAt)}
                              </p>
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {o.receivedAt ? (
                                <>
                                  <p className="max-w-32 truncate text-sm">
                                    {o.receivedBy?.name ?? '—'}
                                  </p>
                                  <p className="text-xs text-muted-foreground tabular-nums">
                                    {fmtDateTime(o.receivedAt)}
                                  </p>
                                </>
                              ) : (
                                <span className="text-xs text-muted-foreground/60">—</span>
                              )}
                            </TableCell>
                            <TableCell className="min-w-0 max-w-32">
                              {!hasDetails ? (
                                <span className="text-xs text-muted-foreground/60">—</span>
                              ) : (
                                <div className="min-w-0 space-y-0.5">
                                  {expected && (
                                    <p
                                      className={cn(
                                        'flex items-center gap-1 text-xs',
                                        overdue
                                          ? 'font-medium text-amber-600 dark:text-amber-400'
                                          : 'text-muted-foreground'
                                      )}
                                      title={
                                        overdue
                                          ? `Overdue — expected ${fmtDate(expected)}`
                                          : `Expected delivery ${fmtDate(expected)}`
                                      }
                                    >
                                      {overdue ? (
                                        <AlertCircle
                                          className="size-3.5 shrink-0"
                                          aria-hidden="true"
                                        />
                                      ) : (
                                        <Calendar className="size-3.5 shrink-0" aria-hidden="true" />
                                      )}
                                      <span className="truncate">{fmtDate(expected)}</span>
                                      {overdue && <span className="sr-only">(overdue)</span>}
                                    </p>
                                  )}
                                  {o.supplier && (
                                    <p className="flex items-center gap-1 text-xs" title={o.supplier}>
                                      <Truck
                                        className="size-3.5 shrink-0 text-muted-foreground"
                                        aria-hidden="true"
                                      />
                                      <span className="max-w-32 truncate">{o.supplier}</span>
                                    </p>
                                  )}
                                  {o.note && (
                                    <p
                                      className="max-w-32 truncate text-xs text-muted-foreground"
                                      title={o.note}
                                    >
                                      {o.note}
                                    </p>
                                  )}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {isOrdered ? (
                                <div className="flex items-center justify-end gap-1">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 px-2.5 focus-visible:ring-primary/30"
                                    disabled={actingId !== null}
                                    onClick={() => setReceiveTarget(o)}
                                  >
                                    {acting ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                                    ) : (
                                      <PackageCheck className="h-3.5 w-3.5" />
                                    )}
                                    Mark received
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 px-2.5 text-red-600 hover:bg-red-50 hover:text-red-700 focus-visible:ring-red-400/30 dark:text-red-400 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                                    disabled={actingId !== null}
                                    onClick={() => setCancelTarget(o)}
                                  >
                                    <XCircle className="h-3.5 w-3.5" />
                                    Cancel
                                  </Button>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground/60">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Receive confirm */}
      <AlertDialog
        open={receiveTarget !== null}
        onOpenChange={(o) => !busyDialog && !o && setReceiveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Receive this purchase order?</AlertDialogTitle>
            <AlertDialogDescription>
              {receiveTarget
                ? `Adds ${receiveTarget.qty} × ${receiveTarget.medicine.name} to stock immediately. Stock will go from ${receiveTarget.currentStock} to ${receiveTarget.currentStock + receiveTarget.qty}.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyDialog}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-500/40"
              disabled={busyDialog}
              onClick={(e) => {
                e.preventDefault()
                if (receiveTarget) void receive(receiveTarget)
              }}
            >
              {busyDialog && <Loader2 className="h-4 w-4 animate-spin" />}
              Receive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel confirm */}
      <AlertDialog
        open={cancelTarget !== null}
        onOpenChange={(o) => !busyDialog && !o && setCancelTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this purchase order?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelTarget
                ? `The order for ${cancelTarget.qty} × ${cancelTarget.medicine.name} will be marked cancelled and will never add stock.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyDialog}>Go back</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500/40"
              disabled={busyDialog}
              onClick={(e) => {
                e.preventDefault()
                if (cancelTarget) void cancelOrder(cancelTarget)
              }}
            >
              {busyDialog && <Loader2 className="h-4 w-4 animate-spin" />}
              Cancel order
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
