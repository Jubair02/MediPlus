'use client'

import { useEffect, useState } from 'react'
import {
  CheckCircle2,
  FileText,
  LogIn,
  MapPin,
  Package,
  Printer,
  RefreshCcw,
  Truck,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { fmtBDT, fmtDate, fmtDateTime } from '@/lib/format'
import {
  ORDER_STATUS_FLOW,
  ORDER_STATUS_LABELS,
  type Order,
  type OrderStatus,
  type PaymentStatus,
} from '@/lib/types'
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { MedImage } from '@/components/store/MedicineCard'
import { printInvoice } from '@/lib/invoice'
import { cn } from '@/lib/utils'

const CANCELABLE: OrderStatus[] = ['PENDING', 'PRESCRIPTION_REVIEW', 'CONFIRMED', 'PROCESSING']

const statusBadgeClass: Record<OrderStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  PRESCRIPTION_REVIEW: 'bg-amber-200 text-amber-900',
  CONFIRMED: 'bg-emerald-100 text-emerald-800',
  PROCESSING: 'bg-teal-100 text-teal-800',
  OUT_FOR_DELIVERY: 'bg-emerald-700 text-white',
  DELIVERED: 'bg-emerald-600 text-white',
  CANCELLED: 'bg-gray-200 text-gray-600',
  FAILED: 'bg-red-100 text-red-700',
}

const paymentStatusBadge: Record<PaymentStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  PAID: 'bg-emerald-100 text-emerald-700',
  FAILED: 'bg-red-100 text-red-700',
  REFUNDED: 'bg-gray-200 text-gray-600',
}

const methodLabel: Record<string, string> = {
  COD: 'Cash on Delivery',
  BKASH_DEMO: 'bKash (Demo)',
}

function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <Badge className={cn('rounded-md', statusBadgeClass[status])}>
      {ORDER_STATUS_LABELS[status]}
    </Badge>
  )
}

/** Vertical tracking stepper through the order lifecycle */
function StatusStepper({ order }: { order: Order }) {
  const flow = ORDER_STATUS_FLOW.filter(
    (s) => s !== 'PRESCRIPTION_REVIEW' || !!order.prescription
  )
  const idx = flow.indexOf(order.status)

  return (
    <ol className="space-y-0" aria-label="Order progress">
      {flow.map((s, i) => {
        const done = i < idx
        const current = i === idx
        const time =
          i === 0 ? order.createdAt : current ? order.updatedAt : null
        return (
          <li key={s} className="flex gap-3">
            <div className="flex flex-col items-center">
              {done && <CheckCircle2 className="size-5 text-emerald-500" aria-hidden="true" />}
              {current && (
                <span className="relative flex size-5 items-center justify-center">
                  <span
                    className="absolute inline-flex size-4 animate-ping rounded-full bg-primary/40"
                    aria-hidden="true"
                  />
                  <span className="relative inline-flex size-2.5 rounded-full bg-primary" aria-hidden="true" />
                </span>
              )}
              {!done && !current && (
                <span className="flex size-5 items-center justify-center">
                  <span className="size-2.5 rounded-full border-2 border-border bg-muted" aria-hidden="true" />
                </span>
              )}
              {i < flow.length - 1 && <span className="my-1 h-6 w-px bg-border" aria-hidden="true" />}
            </div>
            <div className="pb-4">
              <p
                className={cn(
                  'text-sm leading-5',
                  current ? 'font-semibold text-foreground' : done ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                {ORDER_STATUS_LABELS[s]}
              </p>
              {time && (done || current) && (
                <p className="text-xs text-muted-foreground">{fmtDateTime(time)}</p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export default function OrdersView() {
  const user = useAppStore((s) => s.user)
  const setView = useAppStore((s) => s.setView)
  const setAuthOpen = useAppStore((s) => s.setAuthOpen)
  const setCartCount = useAppStore((s) => s.setCartCount)

  const [orders, setOrders] = useState<Order[] | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Order | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<Order | null>(null)
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    if (!user) return
    const ac = new AbortController()
    api<{ orders: Order[] }>('/api/orders', { signal: ac.signal })
      .then((d) => setOrders(d.orders))
      .catch(() => {})
    return () => ac.abort()
  }, [user])

  // Fetch full detail (incl. prescription image) when the dialog opens
  useEffect(() => {
    if (!detailId) return
    const ac = new AbortController()
    setDetail(null)
    setDetailLoading(true)
    api<{ order: Order }>(`/api/orders?id=${encodeURIComponent(detailId)}`, { signal: ac.signal })
      .then((d) => {
        setDetail(d.order)
        setDetailLoading(false)
      })
      .catch(() => setDetailLoading(false))
    return () => ac.abort()
  }, [detailId])

  // ---------- guard ----------
  if (!user) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-primary/10">
          <LogIn className="size-8 text-primary" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-xl font-bold">Sign in to view your orders</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Track deliveries, view prescriptions and reorder in one tap.
        </p>
        <Button className="mt-6 h-11 rounded-xl" onClick={() => setAuthOpen(true)}>
          <LogIn className="size-4" aria-hidden="true" />
          Sign in
        </Button>
      </div>
    )
  }

  const cancelOrder = async () => {
    if (!cancelTarget) return
    setCancelling(true)
    try {
      const d = await api<{ order: Order }>('/api/orders', {
        method: 'PUT',
        body: { action: 'cancel', id: cancelTarget.id },
      })
      setOrders((prev) => prev?.map((o) => (o.id === d.order.id ? d.order : o)) ?? prev)
      toast.success(`Order ${d.order.orderNo} cancelled`)
      setCancelTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel order')
    } finally {
      setCancelling(false)
    }
  }

  const reorder = async (order: Order) => {
    try {
      const d = await api<{ items: unknown[] }>('/api/orders', {
        method: 'PUT',
        body: { action: 'reorder', id: order.id },
      })
      setCartCount(d.items.length)
      setView('cart')
      toast.success('Items added back to your cart')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reorder')
    }
  }

  // ---------- loading ----------
  if (orders === null) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 lg:px-6">
        <Skeleton className="mb-6 h-8 w-40" />
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  // ---------- empty ----------
  if (orders.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-primary/10">
          <Package className="size-8 text-primary" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-xl font-bold">No orders yet</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          When you place an order it will show up here with live tracking.
        </p>
        <Button className="mt-6 h-11 rounded-xl" onClick={() => setView('catalog')}>
          Start shopping
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-4 pb-16 pt-6 lg:px-6">
      <h1 className="text-xl font-bold tracking-tight sm:text-2xl">My orders</h1>

      <div className="mt-6 space-y-4">
        {orders.map((o) => (
          <Card key={o.id} className="gap-4 p-5 shadow-sm">
            {/* Header row */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <p className="font-mono font-bold">{o.orderNo}</p>
              <StatusBadge status={o.status} />
              <p className="ml-auto text-sm text-muted-foreground">{fmtDate(o.createdAt)}</p>
            </div>

            {/* Items row */}
            <div className="flex items-center gap-2">
              {o.items.slice(0, 3).map((it) => (
                <MedImage
                  key={it.id}
                  src={it.image}
                  alt={it.name}
                  className="size-12 shrink-0 rounded-lg border"
                />
              ))}
              {o.items.length > 3 && (
                <span className="flex size-12 shrink-0 items-center justify-center rounded-lg border bg-muted text-xs font-semibold text-muted-foreground">
                  +{o.items.length - 3}
                </span>
              )}
              <div className="ml-2 min-w-0 text-sm">
                <p className="line-clamp-1 text-muted-foreground">
                  {o.items.map((it) => it.name).join(', ')}
                </p>
                <p className="font-semibold">{fmtBDT(o.total)}</p>
              </div>
            </div>

            {/* Delivery staff + actions */}
            <div className="flex flex-wrap items-center gap-2">
              {o.deliveryStaff && (
                <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Truck className="size-3.5" aria-hidden="true" />
                  Delivered by {o.deliveryStaff.name ?? 'delivery staff'}
                </p>
              )}
              <div className="ml-auto flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 rounded-lg"
                  onClick={() => setDetailId(o.id)}
                >
                  Details
                </Button>
                {CANCELABLE.includes(o.status) && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 rounded-lg border-red-200 text-red-600 hover:bg-red-50 hover:text-red-600"
                    onClick={() => setCancelTarget(o)}
                  >
                    Cancel
                  </Button>
                )}
                <Button size="sm" className="h-9 gap-1.5 rounded-lg" onClick={() => void reorder(o)}>
                  <RefreshCcw className="size-3.5" aria-hidden="true" />
                  Reorder
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Cancel confirmation */}
      <AlertDialog open={!!cancelTarget} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this order?</AlertDialogTitle>
            <AlertDialogDescription>
              Order {cancelTarget?.orderNo} will be cancelled and reserved stock will be returned.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 rounded-xl">Keep order</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 rounded-xl bg-red-600 text-white hover:bg-red-700"
              disabled={cancelling}
              onClick={(e) => {
                e.preventDefault()
                void cancelOrder()
              }}
            >
              {cancelling ? 'Cancelling…' : 'Yes, cancel order'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Detail dialog */}
      <Dialog open={!!detailId} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl scrollbar-thin">
          {detailLoading || !detail ? (
            <div className="space-y-4 p-2">
              <DialogTitle className="sr-only">Order details</DialogTitle>
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-32 rounded-xl" />
              <Skeleton className="h-48 rounded-xl" />
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="font-mono">{detail.orderNo}</span>
                  <StatusBadge status={detail.status} />
                </DialogTitle>
                <DialogDescription>Placed {fmtDateTime(detail.createdAt)}</DialogDescription>
              </DialogHeader>

              {/* Cancelled / failed banner */}
              {(detail.status === 'CANCELLED' || detail.status === 'FAILED') && (
                <Alert variant="destructive">
                  <XCircle className="size-4" aria-hidden="true" />
                  <AlertTitle>{ORDER_STATUS_LABELS[detail.status]}</AlertTitle>
                  <AlertDescription>
                    {detail.statusNote || 'This order is no longer active.'}
                  </AlertDescription>
                </Alert>
              )}

              {/* Tracking stepper */}
              {detail.status !== 'CANCELLED' && detail.status !== 'FAILED' && (
                <div className="rounded-xl border p-4">
                  <StatusStepper order={detail} />
                </div>
              )}

              {/* Items */}
              <div className="rounded-xl border">
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
                    {detail.items.map((it) => (
                      <TableRow key={it.id}>
                        <TableCell className="max-w-48">
                          <span className="line-clamp-1">{it.name}</span>
                          {it.requiresPrescription && (
                            <span className="ml-1 inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-600">
                              <FileText className="size-3" aria-hidden="true" />
                              Rx
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">{it.quantity}</TableCell>
                        <TableCell className="text-right">{fmtBDT(it.price)}</TableCell>
                        <TableCell className="text-right font-medium">
                          {fmtBDT(it.price * it.quantity)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Address + payment */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border p-4 text-sm">
                  <p className="mb-1 flex items-center gap-1.5 font-semibold">
                    <MapPin className="size-4 text-primary" aria-hidden="true" />
                    Delivery address
                  </p>
                  <p className="font-medium">{detail.address.recipient}</p>
                  <p className="text-muted-foreground">{detail.address.phone}</p>
                  <p className="mt-1 leading-snug">
                    {detail.address.line1}
                    {detail.address.area ? `, ${detail.address.area}` : ''}, {detail.address.city}
                    {detail.address.postcode ? ` ${detail.address.postcode}` : ''}
                  </p>
                </div>
                <div className="rounded-xl border p-4 text-sm">
                  <p className="mb-1 flex items-center gap-1.5 font-semibold">
                    <Truck className="size-4 text-primary" aria-hidden="true" />
                    Payment & delivery
                  </p>
                  <p className="flex items-center gap-2">
                    {methodLabel[detail.paymentMethod] ?? detail.paymentMethod}
                    <Badge className={cn('rounded-md', paymentStatusBadge[detail.paymentStatus])}>
                      {detail.paymentStatus}
                    </Badge>
                  </p>
                  {detail.deliveryStaff && (
                    <p className="mt-1 text-muted-foreground">
                      Delivery staff: {detail.deliveryStaff.name ?? '—'}
                      {detail.deliveryStaff.phone ? ` · ${detail.deliveryStaff.phone}` : ''}
                    </p>
                  )}
                </div>
              </div>

              {/* Totals */}
              <div className="rounded-xl border p-4 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>{fmtBDT(detail.subtotal)}</span>
                </div>
                {detail.discount > 0 && (
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-muted-foreground">
                      Discount{detail.couponCode ? ` (${detail.couponCode})` : ''}
                    </span>
                    <span className="text-emerald-600">− {fmtBDT(detail.discount)}</span>
                  </div>
                )}
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-muted-foreground">Delivery fee</span>
                  <span>{detail.deliveryFee === 0 ? 'FREE' : fmtBDT(detail.deliveryFee)}</span>
                </div>
                <Separator className="my-2" />
                <div className="flex items-center justify-between font-semibold">
                  <span>Total</span>
                  <span className="text-primary">{fmtBDT(detail.total)}</span>
                </div>
              </div>

              {/* Prescription */}
              {detail.prescription && (
                <div className="rounded-xl border p-4">
                  <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                    <FileText className="size-4 text-primary" aria-hidden="true" />
                    Prescription
                    <Badge
                      className={cn(
                        'rounded-md',
                        detail.prescription.status === 'APPROVED'
                          ? 'bg-emerald-100 text-emerald-700'
                          : detail.prescription.status === 'REJECTED'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-amber-100 text-amber-800'
                      )}
                    >
                      {detail.prescription.status}
                    </Badge>
                  </p>
                  <img
                    src={detail.prescription.image}
                    alt="Prescription"
                    className="max-h-64 w-auto rounded-lg border"
                  />
                  {detail.prescription.reviewNote && (
                    <p className="mt-2 text-sm italic text-muted-foreground">
                      “{detail.prescription.reviewNote}”
                    </p>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-2 border-t pt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const ok = printInvoice(detail)
                    if (!ok) toast.error('Please allow pop-ups to print the invoice')
                  }}
                >
                  <Printer className="size-4" aria-hidden="true" />
                  Print invoice
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
