'use client'

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import type {
  StockRequestItemStatusValue,
  StockRequestPriorityValue,
  StockRequestStatusValue,
} from '@/lib/types'

/**
 * Shared presentation for stock requests.
 *
 * A stock request is one document read by two roles — a pharmacist tracking their
 * ask and an admin deciding it — so the labels and colours live here rather than
 * being written twice. Keyed Records, so the compiler refuses a new status without
 * a label, the way the Stock Log's reason list now does.
 */

export const REQUEST_STATUS_LABELS: Record<StockRequestStatusValue, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under review',
  APPROVED: 'Approved',
  PARTIALLY_APPROVED: 'Part approved',
  REJECTED: 'Rejected',
  ORDERED: 'Ordered',
  PARTIALLY_RECEIVED: 'Part received',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
}

const REQUEST_STATUS_TONES: Record<StockRequestStatusValue, string> = {
  DRAFT: 'border-muted bg-muted text-muted-foreground',
  SUBMITTED: 'border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-300',
  UNDER_REVIEW:
    'border-violet-300 bg-violet-100 text-violet-800 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300',
  APPROVED:
    'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300',
  PARTIALLY_APPROVED:
    'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300',
  REJECTED: 'border-red-300 bg-red-100 text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300',
  ORDERED:
    'border-indigo-300 bg-indigo-100 text-indigo-800 dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-indigo-300',
  PARTIALLY_RECEIVED:
    'border-teal-300 bg-teal-100 text-teal-800 dark:border-teal-500/40 dark:bg-teal-500/10 dark:text-teal-300',
  COMPLETED:
    'border-primary/30 bg-primary/10 text-primary dark:border-primary/40 dark:bg-primary/10 dark:text-primary',
  CANCELLED: 'border-muted bg-muted text-muted-foreground',
}

export const ITEM_STATUS_LABELS: Record<StockRequestItemStatusValue, string> = {
  PENDING: 'Awaiting review',
  APPROVED: 'Approved',
  PARTIALLY_APPROVED: 'Reduced',
  REJECTED: 'Rejected',
  ORDERED: 'Ordered',
  PARTIALLY_RECEIVED: 'Part received',
  RECEIVED: 'Received',
  CANCELLED: 'Cancelled',
}

export const PRIORITY_LABELS: Record<StockRequestPriorityValue, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  EMERGENCY: 'Emergency',
}

const PRIORITY_TONES: Record<StockRequestPriorityValue, string> = {
  LOW: 'border-muted bg-muted text-muted-foreground',
  MEDIUM: 'border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-300',
  HIGH: 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300',
  // The one loud chip on the screen. Emergency raises visibility and nothing else —
  // it cannot shorten the path from approval to stock, which runs through receiving.
  EMERGENCY: 'border-red-500 bg-red-600 font-semibold text-white dark:border-red-400 dark:bg-red-600',
}

export function RequestStatusChip({ status, className }: { status: StockRequestStatusValue; className?: string }) {
  return (
    <Badge variant="outline" className={cn('border whitespace-nowrap', REQUEST_STATUS_TONES[status], className)}>
      {REQUEST_STATUS_LABELS[status]}
    </Badge>
  )
}

export function PriorityChip({ priority, className }: { priority: StockRequestPriorityValue; className?: string }) {
  return (
    <Badge variant="outline" className={cn('border whitespace-nowrap', PRIORITY_TONES[priority], className)}>
      {PRIORITY_LABELS[priority]}
    </Badge>
  )
}

/** Statuses a request can still be acted on from. */
export function isRequestOpen(status: StockRequestStatusValue): boolean {
  return status !== 'COMPLETED' && status !== 'CANCELLED' && status !== 'REJECTED'
}

/** A slim bar showing received against approved — progress, not decoration. */
export function ProgressBar({
  received,
  total,
  className,
}: {
  received: number
  total: number
  className?: string
}) {
  const pct = total <= 0 ? 0 : Math.min(100, Math.round((received / total) * 100))
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted" role="presentation">
        <div
          className={cn('h-full rounded-full transition-[width]', pct === 100 ? 'bg-primary' : 'bg-teal-500')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[11px] tabular-nums text-muted-foreground">
        {received}/{total}
      </span>
    </div>
  )
}
