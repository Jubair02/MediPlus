'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Banknote,
  BadgeDollarSign,
  ChevronLeft,
  ChevronRight,
  Download,
  HandCoins,
  Loader2,
  Smartphone,
  TriangleAlert,
  Truck,
  Undo2,
  Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, getToken } from '@/lib/api'
import { downloadCsv } from '@/lib/download'
import { fmtBDT, fmtDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  ORDER_STATUS_LABELS,
  type AdminPaymentRow,
  type AdminPaymentsSummary,
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface PaymentsResponse {
  rows: AdminPaymentRow[]
  summary: AdminPaymentsSummary
  page: number
  totalPages: number
  total: number
}

const PAYMENT_TONES: Record<PaymentStatus, string> = {
  PENDING: 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-400',
  PAID: 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-400',
  FAILED: 'border-red-300 bg-red-100 text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-400',
  REFUNDED: 'border-border bg-muted text-muted-foreground',
}

/**
 * Order statuses that have already ended. Collecting cash against one of these is not a
 * real action — the money was never going to arrive for a cancelled or failed order, and
 * a delivered order's COD is settled by the driver — so the button is withheld rather
 * than offered and then rejected by the API.
 */
const SETTLED_ORDER_STATUSES = ['CANCELLED', 'FAILED']

const STATUS_FILTERS: { value: PaymentStatus | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'All statuses' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'PAID', label: 'Paid' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'REFUNDED', label: 'Refunded' },
]

const METHOD_FILTERS: { value: 'ALL' | 'COD' | 'BKASH_DEMO'; label: string }[] = [
  { value: 'ALL', label: 'All methods' },
  { value: 'COD', label: 'COD' },
  { value: 'BKASH_DEMO', label: 'bKash' },
]

function StatCard({
  icon: Icon,
  tileClass,
  iconClass,
  label,
  value,
  hint,
}: {
  icon: typeof Banknote
  tileClass: string
  iconClass: string
  label: string
  value: string
  hint: string
}) {
  return (
    <Card className="gap-1 p-4 transition-shadow hover:shadow-md">
      <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg', tileClass)}>
        <Icon className={cn('h-4.5 w-4.5', iconClass)} />
      </div>
      <div>
        <p className="text-2xl font-bold tracking-tight tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
      <p className="text-[11px] text-muted-foreground/80">{hint}</p>
    </Card>
  )
}

function MethodChip({ method }: { method: AdminPaymentRow['method'] }) {
  const cod = method === 'COD'
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border bg-muted/50 px-2 py-1 text-[11px] font-medium text-muted-foreground">
      {cod ? (
        <Banknote className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      {cod ? 'COD' : 'bKash'}
    </span>
  )
}

function PaymentsSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-xl" />
        ))}
      </div>
      <Card className="gap-0 py-4">
        <CardContent className="px-4">
          <div className="overflow-x-auto rounded-md border scrollbar-thin">
            <Table className="min-w-[880px]">
              <TableHeader>
                <TableRow>
                  {[...Array(8)].map((_, i) => (
                    <TableHead key={i}>
                      <Skeleton className="h-4 w-16" />
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...Array(5)].map((_, i) => (
                  <TableRow key={`sk-${i}`}>
                    <TableCell colSpan={8}>
                      <Skeleton className="h-9 w-full" />
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

export default function AdminPayments() {
  const [rows, setRows] = useState<AdminPaymentRow[]>([])
  const [summary, setSummary] = useState<AdminPaymentsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [method, setMethod] = useState<'ALL' | 'COD' | 'BKASH_DEMO'>('ALL')
  const [status, setStatus] = useState<PaymentStatus | 'ALL'>('ALL')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [exportPending, setExportPending] = useState(false)
  const [actingId, setActingId] = useState<string | null>(null)
  const [collectTarget, setCollectTarget] = useState<AdminPaymentRow | null>(null)
  const [refundTarget, setRefundTarget] = useState<AdminPaymentRow | null>(null)

  const buildQuery = useCallback(
    (resource: string, withPage: boolean) => {
      const q = new URLSearchParams({ resource })
      if (method !== 'ALL') q.set('method', method)
      if (status !== 'ALL') q.set('status', status)
      if (withPage) q.set('page', String(page))
      return q.toString()
    },
    [method, status, page]
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const d = await api<PaymentsResponse>(`/api/admin?${buildQuery('payments', true)}`)
      setRows(d.rows)
      setSummary(d.summary)
      setPage(d.page)
      setTotalPages(d.totalPages)
      setTotalCount(d.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load payments')
    } finally {
      setLoading(false)
    }
  }, [buildQuery])

  useEffect(() => {
    void load()
  }, [load])

  /** Silent re-sync (rows + summary) after a mutation — no skeleton flash. */
  const resync = useCallback(async () => {
    try {
      const d = await api<PaymentsResponse>(`/api/admin?${buildQuery('payments', true)}`)
      setRows(d.rows)
      setSummary(d.summary)
      setPage(d.page)
      setTotalPages(d.totalPages)
      setTotalCount(d.total)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to refresh payments')
    }
  }, [buildQuery])

  async function updatePaymentStatus(
    row: AdminPaymentRow,
    next: Extract<PaymentStatus, 'PAID' | 'REFUNDED'>
  ) {
    setActingId(row.orderId)
    try {
      await api<{ order: unknown }>('/api/admin', {
        method: 'PUT',
        body: { action: 'payment-status', orderId: row.orderId, status: next },
      })
      toast.success(next === 'PAID' ? 'Marked as collected' : 'Payment refunded')
      setCollectTarget(null)
      setRefundTarget(null)
      await resync()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update payment')
    } finally {
      setActingId(null)
    }
  }

  /** Export tolerates both contract shapes: JSON {filename, csv} or a raw CSV body. */
  async function exportCsv() {
    setExportPending(true)
    try {
      const res = await fetch(`/api/admin?${buildQuery('payments-export', false)}`, {
        headers: { Authorization: `Bearer ${getToken() ?? ''}` },
      })
      const text = await res.text()
      if (!res.ok) {
        let message = `Export failed (${res.status})`
        try {
          message = (JSON.parse(text) as { error?: string }).error ?? message
        } catch {
          /* raw body */
        }
        throw new Error(message)
      }
      let filename = `payments-${new Date().toISOString().slice(0, 10)}.csv`
      let csv = text
      try {
        const j = JSON.parse(text) as { filename?: string; csv?: string }
        if (typeof j.csv === 'string' && j.csv.length > 0) {
          csv = j.csv
          if (typeof j.filename === 'string' && j.filename) filename = j.filename
        }
      } catch {
        /* raw CSV body */
      }
      downloadCsv(filename, csv)
      toast.success('Payments exported')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to export payments')
    } finally {
      setExportPending(false)
    }
  }

  const safePage = Math.max(1, page)
  const safeTotalPages = Math.max(1, totalPages)

  return (
    <div className="space-y-4">
      {/* Filters + export */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select
          value={method}
          onValueChange={(v) => {
            setMethod(v as 'ALL' | 'COD' | 'BKASH_DEMO')
            setPage(1)
          }}
        >
          <SelectTrigger className="w-full sm:w-[170px]" aria-label="Filter by payment method">
            <SelectValue placeholder="All methods" />
          </SelectTrigger>
          <SelectContent>
            {METHOD_FILTERS.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as PaymentStatus | 'ALL')
            setPage(1)
          }}
        >
          <SelectTrigger className="w-full sm:w-[170px]" aria-label="Filter by payment status">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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

      {error ? (
        <Card className="flex-col items-center gap-2 p-10 text-center">
          <TriangleAlert className="h-8 w-8 text-amber-500" />
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Retry
          </Button>
        </Card>
      ) : loading && !summary ? (
        <PaymentsSkeleton />
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              icon={HandCoins}
              tileClass="bg-emerald-100"
              iconClass="text-emerald-700"
              label="Collected"
              value={fmtBDT(summary?.totalCollected ?? 0)}
              hint={`${summary?.totalCount ?? 0} payment records in the ledger`}
            />
            <StatCard
              icon={Truck}
              tileClass="bg-amber-100"
              iconClass="text-amber-600"
              label="COD pending"
              value={fmtBDT(summary?.codPending ?? 0)}
              hint="Cash awaiting collection on delivery"
            />
            <StatCard
              icon={Smartphone}
              tileClass="bg-primary/10"
              iconClass="text-primary"
              label="bKash received"
              value={fmtBDT(summary?.bkashTotal ?? 0)}
              hint="bKash (demo) payments received"
            />
            <StatCard
              icon={Undo2}
              tileClass="bg-red-100"
              iconClass="text-red-600"
              label="Refunded"
              value={fmtBDT(summary?.refunded ?? 0)}
              hint="Returned to customers"
            />
          </div>

          {/* Ledger table */}
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-12 text-center">
              <Wallet className="h-10 w-10 text-muted-foreground/50" />
              <p className="font-medium">No payments match your filters</p>
              <p className="text-sm text-muted-foreground">
                Try a different method or status — collections land here as orders progress.
              </p>
            </div>
          ) : (
            <Card className="gap-0 py-4">
              <CardContent className="px-4">
                <div className="max-h-[60vh] overflow-auto rounded-md border scrollbar-thin">
                  <Table className="min-w-[880px]" aria-label="Payments ledger">
                    <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_var(--border)]">
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Order</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Order status</TableHead>
                        <TableHead>Transaction</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row) => (
                        <TableRow key={row.orderId} className="transition-colors hover:bg-accent/40">
                          <TableCell>
                            <div className="min-w-0">
                              <p className="font-mono text-xs font-semibold">{row.orderNo}</p>
                              <p className="max-w-40 truncate text-xs text-muted-foreground">
                                {row.customerName}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <MethodChip method={row.method} />
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn('border', PAYMENT_TONES[row.status])}>
                              {row.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right text-sm font-bold tabular-nums">
                            {fmtBDT(row.amount)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            {ORDER_STATUS_LABELS[row.orderStatus] ?? row.orderStatus}
                          </TableCell>
                          <TableCell className="max-w-32 truncate font-mono text-xs text-muted-foreground">
                            {row.transactionId ?? '—'}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            {fmtDate(row.createdAt)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right">
                            {row.status === 'PENDING' &&
                            row.method === 'COD' &&
                            !SETTLED_ORDER_STATUSES.includes(row.orderStatus) ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 px-2 text-xs focus-visible:ring-primary/30"
                                disabled={actingId === row.orderId}
                                onClick={() => setCollectTarget(row)}
                                aria-label={`Mark COD payment collected for order ${row.orderNo}`}
                              >
                                <BadgeDollarSign className="h-3.5 w-3.5" /> Mark collected
                              </Button>
                            ) : row.status === 'PAID' ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 border-red-200 px-2 text-xs text-red-600 hover:bg-red-50 hover:text-red-700 focus-visible:ring-primary/30 dark:border-red-500/40 dark:hover:bg-red-950/40"
                                disabled={actingId === row.orderId}
                                onClick={() => setRefundTarget(row)}
                                aria-label={`Refund payment for order ${row.orderNo}`}
                              >
                                <Undo2 className="h-3.5 w-3.5" /> Refund
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination */}
                <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3">
                  <p className="text-xs text-muted-foreground tabular-nums">
                    Page {safePage} of {safeTotalPages} · {totalCount}{' '}
                    {totalCount === 1 ? 'record' : 'records'}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 focus-visible:ring-primary/30"
                      disabled={safePage <= 1 || loading}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      aria-label="Previous page"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" /> Prev
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 focus-visible:ring-primary/30"
                      disabled={safePage >= safeTotalPages || loading}
                      onClick={() => setPage((p) => Math.min(safeTotalPages, p + 1))}
                      aria-label="Next page"
                    >
                      Next <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Mark collected confirm */}
      <AlertDialog open={collectTarget !== null} onOpenChange={(o) => !o && setCollectTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark payment as collected?</AlertDialogTitle>
            <AlertDialogDescription>
              {collectTarget && (
                <>
                  COD {fmtBDT(collectTarget.amount)} for order{' '}
                  <span className="font-mono font-medium">{collectTarget.orderNo}</span> will be
                  marked{' '}
                  <span className="font-medium text-emerald-700 dark:text-emerald-400">PAID</span>.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-600/30"
              disabled={actingId !== null}
              onClick={(e) => {
                e.preventDefault()
                if (collectTarget) void updatePaymentStatus(collectTarget, 'PAID')
              }}
            >
              {actingId !== null && <Loader2 className="h-4 w-4 animate-spin" />}
              <BadgeDollarSign className="h-4 w-4" /> Mark collected
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Refund confirm */}
      <AlertDialog open={refundTarget !== null} onOpenChange={(o) => !o && setRefundTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Refund this payment?</AlertDialogTitle>
            <AlertDialogDescription>
              {/* A refund is not just a ledger label: unless the order has already ended,
                  the server cancels it and returns any stock it was holding. Say so — the
                  old copy described a status change and nothing else. */}
              {refundTarget && (
                <>
                  {fmtBDT(refundTarget.amount)} collected for order{' '}
                  <span className="font-mono font-medium">{refundTarget.orderNo}</span> will be
                  marked{' '}
                  <span className="font-medium text-red-700 dark:text-red-400">REFUNDED</span>.
                  {refundTarget.orderStatus === 'DELIVERED' ? (
                    <> The order stays marked as delivered.</>
                  ) : SETTLED_ORDER_STATUSES.includes(refundTarget.orderStatus) ? (
                    <> The order is already closed, so only the payment changes.</>
                  ) : (
                    <>
                      {' '}The order will also be <span className="font-medium">cancelled</span> and
                      any stock it is holding returned to inventory.
                    </>
                  )}{' '}
                  This cannot be undone from the ledger.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600/30"
              disabled={actingId !== null}
              onClick={(e) => {
                e.preventDefault()
                if (refundTarget) void updatePaymentStatus(refundTarget, 'REFUNDED')
              }}
            >
              {actingId !== null && <Loader2 className="h-4 w-4 animate-spin" />}
              <Undo2 className="h-4 w-4" /> Refund payment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
