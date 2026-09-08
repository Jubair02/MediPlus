'use client'

import { useMemo, useState } from 'react'
import { Ban, CheckCheck, ClipboardCheck, Loader2, PackagePlus, ShieldAlert, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { StockRequestItemRow, StockRequestRow } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { Textarea } from '@/components/ui/textarea'
import {
  ITEM_STATUS_LABELS,
  PriorityChip,
  ProgressBar,
  REQUEST_STATUS_LABELS,
  RequestStatusChip,
} from './stock-request-ui'

/** Per-line reviewer input, keyed by item id. */
type Decisions = Record<string, { qty: string; note: string }>

/**
 * Keyed on the request id by the wrapper below, so opening a different request gets a
 * fresh component with fresh review state. That is React's own answer to "reset state
 * when a prop changes" — an effect that calls four setters would work, but it renders
 * once with the previous request's decisions still in the inputs.
 */
export default function StockRequestDetail({
  request,
  ...rest
}: {
  request: StockRequestRow | null
  isAdmin: boolean
  currentUserId: string | undefined
  onOpenChange: (open: boolean) => void
  onChanged: (updated: StockRequestRow) => void
}) {
  if (!request) return null
  return <DetailBody key={request.id} request={request} {...rest} />
}

function DetailBody({
  request,
  isAdmin,
  currentUserId,
  onOpenChange,
  onChanged,
}: {
  request: StockRequestRow
  isAdmin: boolean
  currentUserId: string | undefined
  onOpenChange: (open: boolean) => void
  onChanged: (updated: StockRequestRow) => void
}) {
  const [reviewing, setReviewing] = useState(false)
  const [decisions, setDecisions] = useState<Decisions>(() =>
    Object.fromEntries(
      request.items.map((i) => [i.id, { qty: String(i.approvedQty ?? i.requestedQty), note: '' }])
    )
  )
  const [reviewNote, setReviewNote] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const awaitingReview = request.status === 'SUBMITTED' || request.status === 'UNDER_REVIEW'
  // The control the whole workflow exists to provide. Mirrored server-side — this
  // only decides whether to offer the button.
  const isOwnRequest = request.requestedBy.id === currentUserId
  const canReview = isAdmin && awaitingReview && !isOwnRequest
  const canConvert = request.status === 'APPROVED' || request.status === 'PARTIALLY_APPROVED'
  const canCancel =
    (isAdmin || isOwnRequest) && !['COMPLETED', 'CANCELLED', 'REJECTED'].includes(request.status)

  const totals = useMemo(
    () => ({
      approved: request.items.reduce((s, i) => s + (i.approvedQty ?? 0), 0),
      received: request.items.reduce((s, i) => s + i.receivedQty, 0),
    }),
    [request]
  )

  async function act(body: Record<string, unknown>, label: string, key: string) {
    setPending(key)
    setError(null)
    try {
      const d = await api<{ request: StockRequestRow; purchaseOrderIds?: string[] }>('/api/stock-requests', {
        method: 'PUT',
        body: { ...body, id: request.id },
      })
      toast.success(
        d.purchaseOrderIds
          ? `${d.purchaseOrderIds.length} purchase order${d.purchaseOrderIds.length === 1 ? '' : 's'} raised`
          : label
      )
      onChanged(d.request)
      setReviewing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to ${label.toLowerCase()}`)
    } finally {
      setPending(null)
    }
  }

  function submitReview() {
    const bad = request.items.find((i) => {
      const raw = decisions[i.id]?.qty ?? ''
      const n = Number(raw)
      return raw.trim() === '' || !Number.isInteger(n) || n < 0 || n > i.requestedQty
    })
    if (bad) {
      setError(
        `Approved quantity for ${bad.medicine.name} must be a whole number between 0 and ${bad.requestedQty}. Enter 0 to reject it.`
      )
      return
    }
    void act(
      {
        action: 'review',
        reviewNote: reviewNote.trim() || undefined,
        decisions: request.items.map((i) => ({
          itemId: i.id,
          approvedQty: Number(decisions[i.id].qty),
          reviewNote: decisions[i.id].note.trim() || undefined,
        })),
      },
      'Review saved',
      'review'
    )
  }

  const busy = pending !== null

  return (
    <Dialog open onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] gap-0 overflow-y-auto p-0 sm:max-w-4xl">
        <DialogHeader className="border-b px-6 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle className="font-mono text-base">{request.requestNo}</DialogTitle>
            <RequestStatusChip status={request.status} />
            <PriorityChip priority={request.priority} />
          </div>
          <DialogDescription className="sr-only">
            Stock request {request.requestNo}, {REQUEST_STATUS_LABELS[request.status]}
          </DialogDescription>
          <p className="text-xs text-muted-foreground">
            Raised by {request.requestedBy.name ?? request.requestedBy.email} ·{' '}
            {fmtDateTime(request.createdAt)}
            {request.expectedAt && ` · needed by ${fmtDate(request.expectedAt)}`}
          </p>
        </DialogHeader>

        <div className="flex flex-col gap-5 px-6 py-5">
          {request.reason && (
            <div className="rounded-lg border-l-2 border-primary bg-muted/50 px-3 py-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Reason</p>
              <p className="text-sm">{request.reason}</p>
            </div>
          )}

          {request.reviewedBy && (
            <div className="rounded-lg border bg-muted/40 px-3 py-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Reviewed by {request.reviewedBy.name ?? request.reviewedBy.email}
                {request.reviewedAt && ` · ${fmtDateTime(request.reviewedAt)}`}
              </p>
              {request.reviewNote && <p className="mt-0.5 text-sm">{request.reviewNote}</p>}
            </div>
          )}

          {isAdmin && awaitingReview && isOwnRequest && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              You raised this request, so you cannot review it. Another admin has to decide it.
            </p>
          )}

          {/* lines */}
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">Medicine</th>
                  <th className="pb-2 pr-3 text-right font-medium">Stock then</th>
                  <th className="pb-2 pr-3 text-right font-medium">Requested</th>
                  <th className="pb-2 pr-3 text-right font-medium">{reviewing ? 'Approve' : 'Approved'}</th>
                  <th className="pb-2 pr-3 font-medium">Received</th>
                  <th className="pb-2 pr-3 font-medium">State</th>
                </tr>
              </thead>
              <tbody>
                {request.items.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    reviewing={reviewing}
                    decision={decisions[item.id]}
                    onDecision={(patch) =>
                      setDecisions((d) => ({ ...d, [item.id]: { ...d[item.id], ...patch } }))
                    }
                    busy={busy}
                  />
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t text-xs font-medium">
                  <td className="pt-2 pr-3 text-muted-foreground">Total</td>
                  <td />
                  <td className="pt-2 pr-3 text-right tabular-nums">{request.totalRequested}</td>
                  <td className="pt-2 pr-3 text-right tabular-nums">{totals.approved}</td>
                  <td className="pt-2 pr-3 tabular-nums">{totals.received}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          {reviewing && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sr-review-note">Review note (optional)</Label>
              <Textarea
                id="sr-review-note"
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder="Why quantities were reduced or rejected — the requester sees this"
                rows={2}
                maxLength={500}
                disabled={busy}
              />
              <p className="text-[11px] text-muted-foreground">
                Set a quantity to 0 to reject that medicine. Approving cannot exceed what was
                requested — raise a new request to order more.
              </p>
            </div>
          )}

          {/* purchase orders raised from this request */}
          {request.items.some((i) => i.purchaseOrders.length > 0) && (
            <div className="flex flex-col gap-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Purchase orders
              </p>
              <div className="flex flex-col gap-1">
                {request.items.flatMap((i) =>
                  i.purchaseOrders.map((po) => (
                    <div
                      key={po.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-xs"
                    >
                      <span className="min-w-0 truncate">
                        <span className="font-medium">{i.medicine.name}</span>
                        <span className="text-muted-foreground">
                          {' '}
                          · {po.supplier ?? 'no supplier recorded'}
                        </span>
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="tabular-nums text-muted-foreground">
                          {po.receivedQty} of {po.qty} received
                        </span>
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {po.status}
                        </Badge>
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {error && (
            <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="flex-wrap items-center gap-2 border-t px-6 py-4 sm:justify-between">
          <div className="flex items-center gap-2">
            {canCancel && (
              <Button
                variant="ghost"
                className="text-muted-foreground hover:text-red-600"
                onClick={() => void act({ action: 'cancel' }, 'Request cancelled', 'cancel')}
                disabled={busy}
              >
                {pending === 'cancel' ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Ban className="size-4" aria-hidden="true" />
                )}
                Cancel request
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {reviewing ? (
              <>
                <Button variant="outline" onClick={() => setReviewing(false)} disabled={busy}>
                  <X className="size-4" aria-hidden="true" />
                  Discard
                </Button>
                <Button onClick={submitReview} disabled={busy}>
                  {pending === 'review' ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <CheckCheck className="size-4" aria-hidden="true" />
                  )}
                  Save decision
                </Button>
              </>
            ) : (
              <>
                {canReview && (
                  <Button onClick={() => setReviewing(true)} disabled={busy}>
                    <ClipboardCheck className="size-4" aria-hidden="true" />
                    Review
                  </Button>
                )}
                {canConvert && (
                  <Button
                    onClick={() => void act({ action: 'convert-to-po' }, 'Purchase orders raised', 'convert')}
                    disabled={busy}
                  >
                    {pending === 'convert' ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <PackagePlus className="size-4" aria-hidden="true" />
                    )}
                    Raise purchase orders
                  </Button>
                )}
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ItemRow({
  item,
  reviewing,
  decision,
  onDecision,
  busy,
}: {
  item: StockRequestItemRow
  reviewing: boolean
  decision: { qty: string; note: string } | undefined
  onDecision: (patch: Partial<{ qty: string; note: string }>) => void
  busy: boolean
}) {
  const approved = item.approvedQty
  return (
    <tr className="border-b last:border-0">
      <td className="py-2 pr-3">
        <p className="max-w-52 truncate font-medium">{item.medicine.name}</p>
        <p className="text-[11px] text-muted-foreground">
          {item.medicine.brand ? `${item.medicine.brand} · ` : ''}per {item.medicine.unit}
        </p>
        {item.note && <p className="mt-0.5 max-w-52 truncate text-[11px] italic text-muted-foreground">“{item.note}”</p>}
      </td>
      <td
        className={cn(
          'py-2 pr-3 text-right tabular-nums',
          item.stockAtRequest <= 10 ? 'font-semibold text-amber-700 dark:text-amber-400' : 'text-muted-foreground'
        )}
        title="Stock at the moment the request was raised"
      >
        {item.stockAtRequest}
      </td>
      <td className="py-2 pr-3 text-right font-medium tabular-nums">{item.requestedQty}</td>
      <td className="py-2 pr-3 text-right">
        {reviewing ? (
          <div className="flex flex-col items-end gap-1">
            <Input
              value={decision?.qty ?? ''}
              onChange={(e) => onDecision({ qty: e.target.value.replace(/[^\d]/g, '') })}
              inputMode="numeric"
              aria-label={`Approved quantity for ${item.medicine.name}`}
              className="h-8 w-20 text-right tabular-nums"
              disabled={busy}
            />
            <Input
              value={decision?.note ?? ''}
              onChange={(e) => onDecision({ note: e.target.value })}
              placeholder="Note"
              aria-label={`Review note for ${item.medicine.name}`}
              className="h-7 w-32 text-xs"
              maxLength={300}
              disabled={busy}
            />
          </div>
        ) : approved === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span
            className={cn(
              'tabular-nums',
              approved === 0 && 'text-red-600 dark:text-red-400',
              approved > 0 && approved < item.requestedQty && 'text-amber-700 dark:text-amber-400'
            )}
          >
            {approved}
          </span>
        )}
      </td>
      <td className="py-2 pr-3">
        {(item.approvedQty ?? 0) > 0 ? (
          <ProgressBar received={item.receivedQty} total={item.approvedQty ?? 0} />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="py-2 pr-3">
        <span className="text-xs text-muted-foreground">{ITEM_STATUS_LABELS[item.status]}</span>
        {item.reviewNote && (
          <p className="max-w-40 truncate text-[11px] italic text-muted-foreground">{item.reviewNote}</p>
        )}
      </td>
    </tr>
  )
}
