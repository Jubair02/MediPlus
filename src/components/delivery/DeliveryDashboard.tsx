'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bike,
  CheckCircle2,
  ChevronDown,
  Clock,
  HandCoins,
  Loader2,
  MapPin,
  PackageOpen,
  Phone,
  Route,
  StickyNote,
  Truck,
  UserRound,
  XCircle,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { fmtBDT, fmtDate, fmtDateTime } from '@/lib/format'
import { ORDER_STATUS_LABELS, type Order, type OrderStatus } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import MedImage from './MedImage'

const STATUS_TONES: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800 border-amber-300',
  PRESCRIPTION_REVIEW: 'bg-amber-50 text-amber-800 border-amber-400',
  CONFIRMED: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  PROCESSING: 'bg-teal-100 text-teal-800 border-teal-300',
  OUT_FOR_DELIVERY: 'bg-emerald-700 text-white border-emerald-700',
  DELIVERED: 'bg-emerald-600 text-white border-emerald-600',
  CANCELLED: 'bg-gray-100 text-gray-600 border-gray-300',
  FAILED: 'bg-red-100 text-red-800 border-red-300',
}

function StatusBadge({ status }: { status: OrderStatus }) {
  const outline = status === 'PRESCRIPTION_REVIEW'
  return (
    <Badge
      variant={outline ? 'outline' : 'default'}
      className={`border ${STATUS_TONES[status] ?? 'bg-gray-100 text-gray-600 border-gray-300'}`}
    >
      {ORDER_STATUS_LABELS[status]}
    </Badge>
  )
}

function PaymentChip({ order }: { order: Order }) {
  if (order.paymentMethod === 'COD') {
    return (
      <Badge variant="outline" className="border-amber-300 bg-amber-100 text-amber-800">
        Collect {fmtBDT(order.total)} on delivery
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="border-emerald-300 bg-emerald-100 text-emerald-800">
      Paid via bKash
    </Badge>
  )
}

function fullAddress(o: Order): string {
  const a = o.address
  if (!a) return '—'
  return `${a.line1}${a.area ? `, ${a.area}` : ''}, ${a.city}${a.postcode ? ` - ${a.postcode}` : ''}`
}

// ---------- Today's route plan (client-side grouping of active tasks) ----------

interface RouteStop {
  order: Order
  codCollect: number
}

interface RouteGroup {
  area: string
  stops: RouteStop[]
  collect: number
}

function codToCollect(o: Order): number {
  return o.paymentMethod === 'COD' && o.paymentStatus !== 'PAID' ? o.total : 0
}

const COLLECT_CHIP =
  'border-amber-300 bg-amber-100 text-amber-800 tabular-nums dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-400'
const PAID_CHIP =
  'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-400'

function RoutePlanPanel({ groups }: { groups: RouteGroup[] }) {
  // null = untouched → first group expanded by default
  const [openAreas, setOpenAreas] = useState<Set<string> | null>(null)
  const firstArea = groups[0]?.area ?? ''

  const isOpen = (area: string) => (openAreas === null ? area === firstArea : openAreas.has(area))

  function toggle(area: string) {
    setOpenAreas((prev) => {
      const next = new Set(prev ?? (firstArea ? [firstArea] : []))
      if (next.has(area)) next.delete(area)
      else next.add(area)
      return next
    })
  }

  const totalStops = groups.reduce((n, g) => n + g.stops.length, 0)
  const totalCollect = groups.reduce((sum, g) => sum + g.collect, 0)

  return (
    <Card className="gap-3 p-4">
      {/* Panel header */}
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <Route className="h-5 w-5 text-primary" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Today&apos;s route plan</p>
            <p className="truncate text-xs text-muted-foreground">
              Active stops grouped by area — plan your loop
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="secondary" className="tabular-nums">
            {totalStops} {totalStops === 1 ? 'stop' : 'stops'}
          </Badge>
          <Badge variant="outline" className={cn('gap-1', totalCollect > 0 ? COLLECT_CHIP : PAID_CHIP)}>
            <HandCoins className="h-3.5 w-3.5" aria-hidden="true" />
            {totalCollect > 0 ? `Collect ${fmtBDT(totalCollect)}` : 'No COD'}
          </Badge>
        </div>
      </div>

      {/* Area groups */}
      <div className="space-y-2">
        {groups.map((g) => {
          const open = isOpen(g.area)
          return (
            <div key={g.area} className="overflow-hidden rounded-xl border">
              <button
                type="button"
                onClick={() => toggle(g.area)}
                aria-expanded={open}
                className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-xl p-3 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                <MapPin className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0 truncate text-sm font-semibold">{g.area}</span>
                <Badge variant="secondary" className="shrink-0 tabular-nums">
                  {g.stops.length} {g.stops.length === 1 ? 'stop' : 'stops'}
                </Badge>
                {g.collect > 0 ? (
                  <Badge variant="outline" className={cn('gap-1', COLLECT_CHIP)}>
                    <HandCoins className="h-3 w-3" aria-hidden="true" />
                    {fmtBDT(g.collect)}
                  </Badge>
                ) : (
                  <Badge variant="outline" className={PAID_CHIP}>No COD</Badge>
                )}
                <ChevronDown
                  className={cn(
                    'ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
                    open && 'rotate-180'
                  )}
                  aria-hidden="true"
                />
              </button>
              {open && (
                <ul className="border-t px-3 py-1">
                  {g.stops.map(({ order: o, codCollect }) => (
                    <li
                      key={o.id}
                      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b py-2 last:border-b-0"
                    >
                      <span className="shrink-0 font-mono text-xs font-semibold">{o.orderNo}</span>
                      {codCollect > 0 ? (
                        <Badge variant="outline" className={COLLECT_CHIP}>
                          Collect {fmtBDT(codCollect)}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className={PAID_CHIP}>Paid</Badge>
                      )}
                      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                        {o.items?.length ?? 0} {(o.items?.length ?? 0) === 1 ? 'item' : 'items'}
                      </span>
                      <span className="min-w-0 flex-1 basis-32 truncate text-xs text-muted-foreground">
                        {o.address?.recipient ?? o.user?.name ?? '—'}
                        {o.address?.phone ? ` · ${o.address.phone}` : ''}
                      </span>
                      {o.address?.phone && (
                        <Button
                          asChild
                          variant="outline"
                          size="sm"
                          className="ml-auto h-7 shrink-0 px-2 text-xs focus-visible:ring-primary/30"
                        >
                          <a
                            href={`tel:${o.address.phone}`}
                            aria-label={`Call ${o.address.recipient ?? 'customer'} about ${o.orderNo}`}
                          >
                            <Phone className="h-3 w-3" /> Call
                          </a>
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

export default function DeliveryDashboard() {
  const user = useAppStore((s) => s.user)
  const setAuthOpen = useAppStore((s) => s.setAuthOpen)
  const [active, setActive] = useState<Order[]>([])
  const [history, setHistory] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [failTarget, setFailTarget] = useState<Order | null>(null)
  const [failNote, setFailNote] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await api<{ active: Order[]; history: Order[] }>('/api/delivery')
      setActive(d.active)
      setHistory(d.history)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load deliveries')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const stats = useMemo(
    () => ({
      activeCount: active.length,
      delivered: history.filter((o) => o.status === 'DELIVERED').length,
      onTheWay: active.filter((o) => o.status === 'OUT_FOR_DELIVERY').length,
    }),
    [active, history]
  )

  // Route plan: group active orders by area, most stops first, then area name
  const routeGroups = useMemo<RouteGroup[]>(() => {
    const byArea = new Map<string, RouteGroup>()
    for (const t of active) {
      const area = t.address?.area || t.address?.city || 'Unknown area'
      const codCollect = codToCollect(t)
      const existing = byArea.get(area)
      if (existing) {
        existing.stops.push({ order: t, codCollect })
        existing.collect += codCollect
      } else {
        byArea.set(area, { area, stops: [{ order: t, codCollect }], collect: codCollect })
      }
    }
    return [...byArea.values()].sort(
      (a, b) => b.stops.length - a.stops.length || a.area.localeCompare(b.area)
    )
  }, [active])

  const greeting = useMemo(() => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  }, [])

  async function updateStatus(
    order: Order,
    status: 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'FAILED',
    note?: string
  ) {
    setPendingId(order.id)
    try {
      const d = await api<{ order: Order }>('/api/delivery', {
        method: 'PUT',
        body: { orderId: order.id, status, note: note || undefined },
      })
      // Optimistic local move, then refresh from server
      if (status === 'OUT_FOR_DELIVERY') {
        setActive((prev) => [d.order, ...prev.filter((o) => o.id !== order.id)])
      } else {
        setActive((prev) => prev.filter((o) => o.id !== order.id))
        setHistory((prev) => [d.order, ...prev])
      }
      toast.success(
        status === 'DELIVERED'
          ? `Order ${order.orderNo} marked as delivered`
          : status === 'FAILED'
            ? `Order ${order.orderNo} reported as failed`
            : `Order ${order.orderNo} picked up — out for delivery`
      )
      setFailTarget(null)
      setFailNote('')
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update delivery')
    } finally {
      setPendingId(null)
    }
  }

  // Defensive: dashboards render only for the matching role, but stay safe if user is null
  if (!user) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-muted-foreground">Please sign in to access the delivery panel.</p>
        <Button onClick={() => setAuthOpen(true)}>Sign in</Button>
      </div>
    )
  }
  if (user.role !== 'DELIVERY') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <p className="text-muted-foreground">You do not have permission to view this area.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:space-y-6 md:p-6">
      {/* Hero strip */}
      <section className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 p-5 text-white md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-emerald-100">{greeting},</p>
            <h1 className="text-xl font-bold tracking-tight md:text-2xl">
              {user.name ?? 'Delivery Partner'}
            </h1>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-emerald-100/90">
              <Clock className="h-3 w-3" /> {fmtDate(new Date())}
            </p>
          </div>
          <Badge variant="outline" className="border-white/40 bg-white/15 text-white">
            <Bike className="h-3.5 w-3.5" /> Delivery Partner
          </Badge>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-white/10 p-3">
            <p className="text-lg font-bold md:text-2xl">{loading ? '—' : stats.activeCount}</p>
            <p className="text-[11px] text-emerald-50/90 md:text-xs">Active assignments</p>
          </div>
          <div className="rounded-lg bg-white/10 p-3">
            <p className="text-lg font-bold md:text-2xl">{loading ? '—' : stats.onTheWay}</p>
            <p className="text-[11px] text-emerald-50/90 md:text-xs">On the way</p>
          </div>
          <div className="rounded-lg bg-white/10 p-3">
            <p className="text-lg font-bold md:text-2xl">{loading ? '—' : stats.delivered}</p>
            <p className="text-[11px] text-emerald-50/90 md:text-xs">Delivered (history)</p>
          </div>
        </div>
      </section>

      <Tabs defaultValue="active">
        <TabsList className="grid w-full max-w-sm grid-cols-2">
          <TabsTrigger value="active">Active Orders</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        {/* Active orders */}
        <TabsContent value="active" className="mt-4">
          <motion.div
            className="space-y-4"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            {/* Today's route plan (derived from active tasks) */}
            {!loading && routeGroups.length > 0 && <RoutePlanPanel groups={routeGroups} />}

            {loading ? (
              <div className="grid gap-4 md:grid-cols-2 [&>*]:min-w-0">
                {[...Array(2)].map((_, i) => (
                  <Skeleton key={i} className="h-80 w-full rounded-xl" />
                ))}
              </div>
            ) : active.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-12 text-center">
                <PackageOpen className="h-10 w-10 text-muted-foreground/50" />
                <p className="font-medium">No active deliveries</p>
                <p className="text-sm text-muted-foreground">
                  New assignments will appear here — check back soon.
                </p>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 [&>*]:min-w-0">
                {active.map((order) => (
                  <Card key={order.id} className="gap-3 p-4 transition-shadow hover:shadow-md">
                    {/* Header */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm font-semibold">{order.orderNo}</span>
                      <StatusBadge status={order.status} />
                    </div>

                    {/* Customer */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2 text-sm">
                        <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate font-medium">
                          {order.user?.name ?? order.address?.recipient ?? '—'}
                        </span>
                      </div>
                      {order.address?.phone && (
                        <Button asChild variant="outline" size="sm">
                          <a href={`tel:${order.address.phone}`}>
                            <Phone className="h-3.5 w-3.5" /> Call
                          </a>
                        </Button>
                      )}
                    </div>

                    {/* Address */}
                    <div className="flex min-w-0 gap-2 rounded-lg border p-2.5 text-sm">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{fullAddress(order)}</p>
                        <p className="text-xs text-muted-foreground">
                          {order.address?.label} · {order.address?.recipient} ·{' '}
                          {order.address?.phone}
                        </p>
                      </div>
                    </div>

                    {/* Customer delivery instructions */}
                    {order.notes && (
                      <div
                        className="flex gap-2 rounded-lg border border-amber-300/70 bg-amber-50 p-2.5 text-sm dark:border-amber-500/30 dark:bg-amber-500/10"
                        aria-label={`Customer note: ${order.notes}`}
                      >
                        <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                            Delivery instructions
                          </p>
                          <p className="mt-0.5 break-words text-amber-950 dark:text-amber-100">{order.notes}</p>
                        </div>
                      </div>
                    )}

                    {/* Items */}
                    <div className="max-h-32 space-y-1.5 overflow-y-auto rounded-lg border p-2 scrollbar-thin">
                      {(order.items ?? []).map((it) => (
                        <div key={it.id} className="flex items-center gap-2">
                          <MedImage src={it.image} alt={it.name} className="h-8 w-8 rounded" />
                          <span className="min-w-0 flex-1 truncate text-sm">{it.name}</span>
                          <span className="text-xs text-muted-foreground">× {it.quantity}</span>
                        </div>
                      ))}
                    </div>

                    {/* Payment */}
                    <PaymentChip order={order} />

                    {/* Actions */}
                    {order.status === 'PROCESSING' && (
                      <Button
                        className="w-full"
                        disabled={pendingId === order.id}
                        onClick={() => void updateStatus(order, 'OUT_FOR_DELIVERY')}
                      >
                        {pendingId === order.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Truck className="h-4 w-4" />
                        )}
                        Picked up — Out for delivery
                      </Button>
                    )}
                    {order.status === 'OUT_FOR_DELIVERY' && (
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          className="bg-emerald-600 text-white hover:bg-emerald-700"
                          disabled={pendingId === order.id}
                          onClick={() => void updateStatus(order, 'DELIVERED')}
                        >
                          {pendingId === order.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4" />
                          )}
                          Mark Delivered
                        </Button>
                        <Button
                          variant="outline"
                          className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                          disabled={pendingId === order.id}
                          onClick={() => {
                            setFailNote('')
                            setFailTarget(order)
                          }}
                        >
                          <XCircle className="h-4 w-4" /> Report Failed
                        </Button>
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </motion.div>
        </TabsContent>

        {/* History */}
        <TabsContent value="history" className="mt-4">
          {loading ? (
            <Skeleton className="h-72 w-full rounded-xl" />
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-12 text-center">
              <PackageOpen className="h-10 w-10 text-muted-foreground/50" />
              <p className="font-medium">No completed deliveries yet</p>
              <p className="text-sm text-muted-foreground">
                Delivered and failed orders will be listed here.
              </p>
            </div>
          ) : (
            <Card className="gap-0 py-4">
              <CardContent className="px-4">
                <div className="overflow-x-auto scrollbar-thin">
                  <Table className="min-w-[720px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Order</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>City</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Note</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.map((o) => (
                        <TableRow key={o.id} className="transition-colors hover:bg-accent/40">
                          <TableCell className="whitespace-nowrap font-mono text-xs font-medium">
                            {o.orderNo}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            {fmtDateTime(o.createdAt)}
                          </TableCell>
                          <TableCell className="max-w-32 truncate text-sm">
                            {o.address?.city ?? '—'}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right font-medium">
                            {fmtBDT(o.total)}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={o.status} />
                          </TableCell>
                          <TableCell className="max-w-48 truncate text-xs text-muted-foreground">
                            {o.notes && (
                              <StickyNote
                                className="mr-1 inline h-3 w-3 text-amber-500"
                                aria-label={`Customer note: ${o.notes}`}
                              />
                            )}
                            {o.statusNote ?? '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Failed delivery dialog */}
      <Dialog open={failTarget !== null} onOpenChange={(o) => !o && setFailTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Report failed delivery</DialogTitle>
            <DialogDescription>
              Order {failTarget?.orderNo} — add an optional note about what went wrong.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={3}
            value={failNote}
            onChange={(e) => setFailNote(e.target.value)}
            placeholder="e.g. Customer unreachable, address not found..."
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setFailTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pendingId === failTarget?.id}
              onClick={() => {
                if (failTarget) void updateStatus(failTarget, 'FAILED', failNote.trim() || undefined)
              }}
            >
              {pendingId === failTarget?.id && <Loader2 className="h-4 w-4 animate-spin" />}
              <XCircle className="h-4 w-4" /> Report failed
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
