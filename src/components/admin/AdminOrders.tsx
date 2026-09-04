'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Download,
  Loader2,
  Mail,
  MapPin,
  PackageSearch,
  Phone,
  Search,
  StickyNote,
  UserRound,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { downloadCsv } from '@/lib/download'
import { fmtBDT, fmtDateTime } from '@/lib/format'
import {
  ORDER_STATUS_LABELS,
  ORDER_TRANSITIONS,
  type AuthUser,
  type Order,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
} from '@/lib/types'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
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

const PAYMENT_TONES: Record<PaymentStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-800 border-amber-300',
  PAID: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  FAILED: 'bg-red-100 text-red-800 border-red-300',
  REFUNDED: 'bg-gray-100 text-gray-600 border-gray-300',
}

const RX_TONES: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800 border-amber-300',
  APPROVED: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  REJECTED: 'bg-red-100 text-red-800 border-red-300',
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

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</p>
  )
}

export default function AdminOrders() {
  const [orders, setOrders] = useState<Order[]>([])
  const [deliveryStaff, setDeliveryStaff] = useState<AuthUser[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editStatus, setEditStatus] = useState<OrderStatus>('PENDING')
  const [editStaff, setEditStaff] = useState('NONE')
  const [savePending, setSavePending] = useState(false)
  const [exportPending, setExportPending] = useState(false)
  // The prescription image is the one field the list no longer carries — it is a base64
  // blob, and loading every order's copy to render at most one of them cost megabytes per
  // page load. The dialog fetches the single order it needs instead. The fetched image is
  // stamped with the order it belongs to so a slow response cannot land on the next order.
  const [rx, setRx] = useState<{ orderId: string; image: string | null } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [o, s] = await Promise.all([
        api<{ orders: Order[] }>('/api/admin?resource=orders'),
        api<{ deliveryStaff: AuthUser[] }>('/api/admin?resource=staff'),
      ])
      setOrders(o.orders)
      setDeliveryStaff(s.deliveryStaff)
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

  const selected = useMemo(() => orders.find((o) => o.id === selectedId) ?? null, [orders, selectedId])

  /** Terminal orders are a record, not a work queue — their driver assignment is frozen. */
  const assignmentLocked = !!selected && ORDER_TRANSITIONS[selected.status].length === 0

  useEffect(() => {
    if (!selectedId) return
    const ac = new AbortController()
    const settle = (image: string | null) => {
      if (!ac.signal.aborted) setRx({ orderId: selectedId, image })
    }
    api<{ order: Order }>(`/api/admin?resource=order&id=${encodeURIComponent(selectedId)}`, {
      signal: ac.signal,
    })
      .then((d) => settle(d.order.prescription?.image ?? null))
      .catch(() => settle(null))
    return () => ac.abort()
  }, [selectedId])

  const rxImage = rx && rx.orderId === selectedId ? rx.image : null
  const rxLoading = !rx || rx.orderId !== selectedId

  async function exportCsv() {
    setExportPending(true)
    try {
      const d = await api<{ filename: string; csv: string }>('/api/admin?resource=export-orders')
      if (typeof d.csv !== 'string' || typeof d.filename !== 'string')
        throw new Error('Export unavailable')
      downloadCsv(d.filename, d.csv)
      toast.success('Orders exported')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to export orders')
    } finally {
      setExportPending(false)
    }
  }

  function openDialog(order: Order) {
    setSelectedId(order.id)
    setEditStatus(order.status)
    setEditStaff(order.deliveryStaff?.id ?? 'NONE')
  }

  async function saveOrder() {
    if (!selected) return
    setSavePending(true)
    try {
      const d = await api<{ order: Order }>('/api/admin', {
        method: 'PUT',
        body: {
          action: 'update-order',
          id: selected.id,
          status: editStatus,
          // Omitted entirely when frozen, so a save that only changes the status is not
          // rejected for "changing" an assignment it is merely echoing back.
          ...(assignmentLocked ? {} : { deliveryStaffId: editStaff === 'NONE' ? null : editStaff }),
        },
      })
      setOrders((prev) => prev.map((o) => (o.id === d.order.id ? d.order : o)))
      toast.success(`Order ${d.order.orderNo} updated`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update order')
    } finally {
      setSavePending(false)
    }
  }

  return (
    <div className="space-y-4">
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
        <div className="sm:ml-auto">
          <Button variant="outline" onClick={() => void exportCsv()} disabled={exportPending}>
            {exportPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Export CSV
          </Button>
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
                  <TableHead>Delivery staff</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Manage</TableHead>
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
                        <p className="text-sm text-muted-foreground">
                          No orders match your filters.
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((o) => (
                    <TableRow key={o.id} className="transition-colors hover:bg-accent/40">
                      <TableCell className="whitespace-nowrap font-mono text-xs font-medium">
                        {o.orderNo}
                        {o.notes && (
                          <StickyNote
                            className="ml-1.5 inline h-3 w-3 text-amber-500"
                            aria-label={`Has customer note: ${o.notes}`}
                          />
                        )}
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
                      <TableCell className="max-w-32 truncate text-sm text-muted-foreground">
                        {o.deliveryStaff?.name ?? '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {fmtDateTime(o.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" onClick={() => openDialog(o)}>
                          Manage
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Manage dialog */}
      <Dialog open={selectedId !== null} onOpenChange={(o) => !o && setSelectedId(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto scrollbar-thin sm:max-w-2xl">
          {!selected && <DialogTitle className="sr-only">Order details</DialogTitle>}
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="font-mono">{selected.orderNo}</DialogTitle>
                <DialogDescription>
                  Placed {fmtDateTime(selected.createdAt)} · <StatusBadge status={selected.status} />
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {/* Customer */}
                <div className="space-y-2">
                  <SectionTitle>Customer</SectionTitle>
                  <div className="grid gap-2 rounded-lg border p-3 text-sm sm:grid-cols-2">
                    <span className="flex items-center gap-2">
                      <UserRound className="h-4 w-4 text-muted-foreground" />
                      {selected.user?.name ?? selected.address?.recipient ?? '—'}
                    </span>
                    <span className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      {selected.user?.email ?? '—'}
                    </span>
                    <span className="flex items-center gap-2">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      {selected.user?.phone ?? selected.address?.phone ?? '—'}
                    </span>
                  </div>
                </div>

                {/* Address */}
                <div className="space-y-2">
                  <SectionTitle>Delivery address</SectionTitle>
                  <div className="flex gap-2 rounded-lg border p-3 text-sm">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div>
                      <p className="font-medium">
                        {selected.address?.recipient}
                        <Badge variant="secondary" className="ml-2">
                          {selected.address?.label}
                        </Badge>
                      </p>
                      <p className="text-muted-foreground">
                        {selected.address?.line1}
                        {selected.address?.area ? `, ${selected.address.area}` : ''},{' '}
                        {selected.address?.city}
                        {selected.address?.postcode ? ` - ${selected.address.postcode}` : ''}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Customer note */}
                {selected.notes && (
                  <div className="space-y-2">
                    <SectionTitle>Customer note</SectionTitle>
                    <div
                      className="flex gap-2 rounded-lg border border-amber-300/70 bg-amber-50 p-3 text-sm dark:border-amber-500/30 dark:bg-amber-500/10"
                      aria-label={`Customer note: ${selected.notes}`}
                    >
                      <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                      <p className="min-w-0 break-words text-amber-950 dark:text-amber-100">{selected.notes}</p>
                    </div>
                  </div>
                )}

                {/* Items */}
                <div className="space-y-2">
                  <SectionTitle>Items ({selected.items?.length ?? 0})</SectionTitle>
                  <div className="rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Item</TableHead>
                          <TableHead className="text-center">Qty</TableHead>
                          <TableHead className="text-right">Price</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(selected.items ?? []).map((it) => (
                          <TableRow key={it.id}>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <MedImage src={it.image} alt={it.name} className="h-8 w-8 rounded" />
                                <span className="text-sm">{it.name}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-center text-sm">{it.quantity}</TableCell>
                            <TableCell className="text-right text-sm">{fmtBDT(it.price)}</TableCell>
                            <TableCell className="text-right text-sm font-medium">
                              {fmtBDT(it.price * it.quantity)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>

                {/* Prescription */}
                {selected.prescription && (
                  <div className="space-y-2">
                    <SectionTitle>Prescription</SectionTitle>
                    <div className="space-y-2 rounded-lg border p-3">
                      {rxLoading && !rxImage ? (
                        <Skeleton className="h-64 w-full rounded-lg" />
                      ) : (
                        <MedImage
                          src={rxImage}
                          alt="Prescription"
                          className="max-h-64 w-full rounded-lg object-contain"
                        />
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant={selected.prescription.status === 'PENDING' ? 'outline' : 'default'}
                          className={`border ${RX_TONES[selected.prescription.status] ?? ''}`}
                        >
                          {selected.prescription.status}
                        </Badge>
                        {selected.prescription.reviewNote ? (
                          <span className="text-xs text-muted-foreground">
                            Review note: {selected.prescription.reviewNote}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                )}

                {/* Payment + totals */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <SectionTitle>Payment</SectionTitle>
                    <div className="space-y-1.5 rounded-lg border p-3 text-sm">
                      <p className="font-medium">{paymentLabel(selected.paymentMethod)}</p>
                      <Badge
                        variant="outline"
                        className={`border ${PAYMENT_TONES[selected.paymentStatus]}`}
                      >
                        {selected.paymentStatus}
                      </Badge>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <SectionTitle>Totals</SectionTitle>
                    <div className="space-y-1.5 rounded-lg border p-3 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Subtotal</span>
                        <span>{fmtBDT(selected.subtotal)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          Discount{selected.couponCode ? ` (${selected.couponCode})` : ''}
                        </span>
                        <span className="text-emerald-700">- {fmtBDT(selected.discount)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Delivery fee</span>
                        <span>{fmtBDT(selected.deliveryFee)}</span>
                      </div>
                      <Separator />
                      <div className="flex justify-between font-semibold">
                        <span>Total</span>
                        <span>{fmtBDT(selected.total)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Update zone */}
                <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                  <SectionTitle>Update order</SectionTitle>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="order-status">Status</Label>
                      <Select value={editStatus} onValueChange={(v) => setEditStatus(v as OrderStatus)}>
                        <SelectTrigger id="order-status" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {/* Only the moves the API will accept. Stock follows status, so
                              an arbitrary jump would double-count or strand inventory. */}
                          {Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => (
                            <SelectItem
                              key={value}
                              value={value}
                              disabled={
                                value !== selected.status &&
                                !ORDER_TRANSITIONS[selected.status].includes(value as OrderStatus)
                              }
                            >
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {ORDER_TRANSITIONS[selected.status].length === 0 && (
                        <p className="text-xs text-muted-foreground">
                          {ORDER_STATUS_LABELS[selected.status]} is a final status — this order can no
                          longer be changed.
                        </p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="order-staff">Delivery staff</Label>
                      <Select value={editStaff} onValueChange={setEditStaff} disabled={assignmentLocked}>
                        <SelectTrigger id="order-staff" className="w-full">
                          <SelectValue placeholder="Unassigned" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="NONE">Unassigned</SelectItem>
                          {deliveryStaff.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name ?? s.email}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {assignmentLocked && (
                        <p className="text-xs text-muted-foreground">
                          Assignment is fixed once an order reaches{' '}
                          {ORDER_STATUS_LABELS[selected.status]}.
                        </p>
                      )}
                    </div>
                  </div>
                  <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={() => setSelectedId(null)}>
                      Close
                    </Button>
                    <Button onClick={() => void saveOrder()} disabled={savePending}>
                      {savePending && <Loader2 className="h-4 w-4 animate-spin" />}
                      Save changes
                    </Button>
                  </DialogFooter>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
