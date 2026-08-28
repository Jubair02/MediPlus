'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Eye, FileCheck, Info, PackageSearch, Search, StickyNote } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { fmtBDT, fmtDateTime } from '@/lib/format'
import {
  ORDER_STATUS_FLOW,
  ORDER_STATUS_LABELS,
  type Order,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
} from '@/lib/types'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

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

const PAYMENT_TONES: Record<PaymentStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-800 border-amber-300',
  PAID: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  FAILED: 'bg-red-100 text-red-800 border-red-300',
  REFUNDED: 'bg-gray-100 text-gray-600 border-gray-300',
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

function paymentLabel(m: PaymentMethod): string {
  return m === 'COD' ? 'Cash on Delivery' : 'bKash'
}

function Timeline({ status }: { status: OrderStatus }) {
  if (status === 'CANCELLED' || status === 'FAILED') {
    return (
      <p className="text-sm text-muted-foreground">
        This order is closed — final status: {ORDER_STATUS_LABELS[status]}.
      </p>
    )
  }
  const idx = ORDER_STATUS_FLOW.indexOf(status)
  return (
    <ol className="flex flex-wrap items-start gap-y-2">
      {ORDER_STATUS_FLOW.map((s, i) => {
        const done = i <= idx
        return (
          <li key={s} className="flex items-center">
            <div className="flex w-16 flex-col items-center gap-1 text-center">
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                  done ? 'bg-emerald-600 text-white' : 'border border-border bg-muted text-muted-foreground'
                }`}
              >
                {i + 1}
              </span>
              <span className={`text-[10px] leading-tight ${done ? 'font-medium text-emerald-700' : 'text-muted-foreground'}`}>
                {ORDER_STATUS_LABELS[s]}
              </span>
            </div>
            {i < ORDER_STATUS_FLOW.length - 1 && (
              <span className={`mx-0.5 mt-2.5 h-px w-5 ${i < idx ? 'bg-emerald-500' : 'bg-border'}`} />
            )}
          </li>
        )
      })}
    </ol>
  )
}

export default function PharmacistOrders() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await api<{ orders: Order[] }>('/api/pharmacist?resource=orders')
      setOrders(d.orders)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load orders')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return orders.filter((o) => {
      if (statusFilter !== 'ALL' && o.status !== statusFilter) return false
      if (!q) return true
      const customer = `${o.user?.name ?? ''} ${o.address?.recipient ?? ''}`.toLowerCase()
      return o.orderNo.toLowerCase().includes(q) || customer.includes(q)
    })
  }, [orders, search, statusFilter])

  const selected = useMemo(
    () => orders.find((o) => o.id === selectedId) ?? null,
    [orders, selectedId]
  )

  return (
    <div className="space-y-4">
      <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900">
        <Info className="h-4 w-4 text-emerald-600" />
        <AlertDescription>
          Prescriptions are managed in the Prescriptions tab — approving one confirms its linked
          order automatically.
        </AlertDescription>
      </Alert>

      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[190px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order no or customer"
            className="pl-8"
          />
        </div>
      </div>

      {/* Table */}
      <Card className="gap-0 py-4">
        <CardContent className="px-4">
          <div className="overflow-x-auto scrollbar-thin">
            <Table className="min-w-[820px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-center">Items</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-center">Rx</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">View</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  [...Array(5)].map((_, i) => (
                    <TableRow key={`sk-${i}`}>
                      <TableCell colSpan={8}>
                        <Skeleton className="h-8 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8}>
                      <div className="flex flex-col items-center gap-2 py-10 text-center">
                        <PackageSearch className="h-8 w-8 text-muted-foreground/50" />
                        <p className="text-sm text-muted-foreground">No orders match your filters.</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((o) => {
                    const hasRx = (o.items ?? []).some((it) => it.requiresPrescription)
                    return (
                      <TableRow key={o.id} className="transition-colors hover:bg-accent/40">
                        <TableCell className="whitespace-nowrap font-mono text-xs font-medium">
                          <span className="inline-flex items-center gap-1.5">
                            {o.orderNo}
                            {o.notes && (
                              <span
                                title={`Customer note: ${o.notes}`}
                                aria-label={`Has customer note: ${o.notes}`}
                                className="inline-flex text-amber-500"
                              >
                                <StickyNote className="h-3 w-3" aria-hidden="true" />
                              </span>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-40 truncate">
                          {o.user?.name ?? o.address?.recipient ?? '—'}
                        </TableCell>
                        <TableCell className="text-center text-sm">{o.items?.length ?? 0}</TableCell>
                        <TableCell className="whitespace-nowrap text-right font-medium">
                          {fmtBDT(o.total)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={o.status} />
                        </TableCell>
                        <TableCell className="text-center">
                          {hasRx ? (
                            <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
                              Rx
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {fmtDateTime(o.createdAt)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setSelectedId(o.id)}
                            aria-label={`View ${o.orderNo}`}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
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

      {/* Detail dialog (read-only) */}
      <Dialog open={selectedId !== null} onOpenChange={(o) => !o && setSelectedId(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto scrollbar-thin sm:max-w-xl">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="font-mono">{selected.orderNo}</DialogTitle>
                <DialogDescription>
                  Placed {fmtDateTime(selected.createdAt)} · <StatusBadge status={selected.status} />
                </DialogDescription>
              </DialogHeader>

              {/* Timeline */}
              <div className="rounded-lg border p-3">
                <p className="pb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Progress
                </p>
                <Timeline status={selected.status} />
                {selected.statusNote && (
                  <p className="mt-2 text-xs text-muted-foreground">Note: {selected.statusNote}</p>
                )}
              </div>

              {/* Customer delivery note */}
              {selected.notes && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-900/60 dark:bg-amber-950/20">
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-400">
                    <StickyNote className="h-3.5 w-3.5" aria-hidden="true" />
                    Customer note
                  </p>
                  <p className="mt-1 text-sm text-amber-950 dark:text-amber-100">{selected.notes}</p>
                </div>
              )}

              {/* Items */}
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Items ({selected.items?.length ?? 0})
                </p>
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead className="text-center">Qty</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(selected.items ?? []).map((it) => (
                        <TableRow
                          key={it.id}
                          className={it.requiresPrescription ? 'bg-amber-50/70' : undefined}
                        >
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="text-sm">{it.name}</span>
                              {it.requiresPrescription && (
                                <Badge
                                  variant="outline"
                                  className="border-amber-300 bg-amber-50 text-[10px] text-amber-800"
                                >
                                  Rx
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-center text-sm">{it.quantity}</TableCell>
                          <TableCell className="text-right text-sm font-medium">
                            {fmtBDT(it.price * it.quantity)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Address + payment */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5 rounded-lg border p-3 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Delivery address
                  </p>
                  <p className="font-medium">{selected.address?.recipient}</p>
                  <p className="text-muted-foreground">
                    {selected.address?.line1}
                    {selected.address?.area ? `, ${selected.address.area}` : ''},{' '}
                    {selected.address?.city}
                  </p>
                  <p className="text-xs text-muted-foreground">Phone: {selected.address?.phone}</p>
                </div>
                <div className="space-y-1.5 rounded-lg border p-3 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Payment
                  </p>
                  <p className="font-medium">{paymentLabel(selected.paymentMethod)}</p>
                  <Badge variant="outline" className={`border ${PAYMENT_TONES[selected.paymentStatus]}`}>
                    {selected.paymentStatus}
                  </Badge>
                  <Separator className="my-1" />
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total</span>
                    <span className="font-semibold">{fmtBDT(selected.total)}</span>
                  </div>
                </div>
              </div>

              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <FileCheck className="h-3.5 w-3.5" />
                Prescription-linked items are highlighted — review them in the Prescriptions tab.
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
