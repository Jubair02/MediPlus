import type { StockRequestItemStatus, StockRequestStatus } from '@prisma/client'

/**
 * The decidable parts of the stock request and receiving workflow.
 *
 * Everything here is pure: no database, no Prisma client, no clock. The Prisma
 * import is a type and is erased at build, so this module loads directly in the
 * Node test runner and the rules can be tested without a database — which matters
 * because these functions decide when stock is allowed to move.
 *
 * What is NOT here, deliberately: anything that has to be atomic. Refusing an
 * over-receipt is a claim on a row (`receivedQty: { lte: qty - receiptQty }`),
 * not an if-statement, and lives in the route inside a transaction. These
 * functions compute what to claim and what to say when the claim fails.
 */

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

/**
 * Legal stock request transitions, in the spirit of ORDER_TRANSITIONS.
 *
 * A request never moves backwards: once reviewed it cannot return to review, and
 * once rejected it cannot become approved. That is what stops a decision being
 * quietly overwritten after someone acted on it.
 */
export const SR_TRANSITIONS: Record<StockRequestStatus, readonly StockRequestStatus[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['UNDER_REVIEW', 'CANCELLED'],
  UNDER_REVIEW: ['APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['ORDERED', 'CANCELLED'],
  PARTIALLY_APPROVED: ['ORDERED', 'CANCELLED'],
  // Terminal: nothing was approved, so there is nothing to order.
  REJECTED: [],
  ORDERED: ['PARTIALLY_RECEIVED', 'COMPLETED', 'CANCELLED'],
  // Same-state is legal: the third of five deliveries is still "partially received".
  PARTIALLY_RECEIVED: ['PARTIALLY_RECEIVED', 'COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
}

export function canTransition(from: StockRequestStatus, to: StockRequestStatus): boolean {
  return SR_TRANSITIONS[from].includes(to)
}

/** A request may still be edited by its owner only while it is a draft. */
export function isEditable(status: StockRequestStatus): boolean {
  return status === 'DRAFT'
}

/** Statuses a reviewer may act on. */
export function isReviewable(status: StockRequestStatus): boolean {
  return status === 'SUBMITTED' || status === 'UNDER_REVIEW'
}

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

export interface RequestLine {
  id: string
  requestedQty: number
  /** null until reviewed; 0 means reviewed and rejected. */
  approvedQty: number | null
}

export interface ApprovalDecision {
  itemId: string
  approvedQty: number
}

/**
 * Check a reviewer's decisions against the lines they are deciding on.
 *
 * A reviewer may cut a line or reject it outright, but never approve more than was
 * asked for: wanting more is a new request, which keeps the record honest about who
 * asked for what. Every line must be decided, so a request cannot be half-reviewed
 * and left in a state where nobody knows whether the rest was refused or forgotten.
 */
export function validateApproval(
  lines: readonly RequestLine[],
  decisions: readonly ApprovalDecision[]
): { error: string } | { ok: true } {
  if (lines.length === 0) return { error: 'This request has no items to review' }

  const byId = new Map(lines.map((l) => [l.id, l]))
  const seen = new Set<string>()

  for (const d of decisions) {
    const line = byId.get(d.itemId)
    if (!line) return { error: 'This request does not contain one of the items you reviewed' }
    if (seen.has(d.itemId)) return { error: 'One of the items was decided twice' }
    seen.add(d.itemId)

    if (!Number.isInteger(d.approvedQty)) return { error: 'Approved quantity must be a whole number' }
    if (d.approvedQty < 0) return { error: 'Approved quantity cannot be negative' }
    if (d.approvedQty > line.requestedQty) {
      return {
        error: `Approved quantity cannot exceed the ${line.requestedQty} requested. Raise a new request to order more.`,
      }
    }
  }

  const undecided = lines.filter((l) => !seen.has(l.id))
  if (undecided.length > 0) {
    return {
      error:
        undecided.length === 1
          ? 'One item has not been decided. Approve or reject every item to finish the review.'
          : `${undecided.length} items have not been decided. Approve or reject every item to finish the review.`,
    }
  }

  return { ok: true }
}

/** The status a line takes once a reviewer has decided it. */
export function deriveItemStatusAfterReview(line: RequestLine): StockRequestItemStatus {
  if (line.approvedQty === null) return 'PENDING'
  if (line.approvedQty === 0) return 'REJECTED'
  if (line.approvedQty >= line.requestedQty) return 'APPROVED'
  return 'PARTIALLY_APPROVED'
}

/**
 * The request status implied by its reviewed lines.
 *
 * Derived rather than taken from the client so the header can never disagree with
 * the lines beneath it — the failure mode where a request reads APPROVED while
 * carrying a rejected item.
 */
export function deriveRequestStatusAfterReview(lines: readonly RequestLine[]): StockRequestStatus {
  if (lines.length === 0) return 'REJECTED'
  const approved = lines.filter((l) => (l.approvedQty ?? 0) > 0)
  if (approved.length === 0) return 'REJECTED'
  const allInFull = lines.every((l) => l.approvedQty === l.requestedQty)
  return allInFull ? 'APPROVED' : 'PARTIALLY_APPROVED'
}

// ---------------------------------------------------------------------------
// Progress — ordering and receiving
// ---------------------------------------------------------------------------

export interface LineProgress {
  /** 0 for a rejected line. */
  approvedQty: number
  /** Sum of this line's purchase order quantities. Derived, never stored. */
  orderedQty: number
  /** Sum of this line's receipts. Derived, never stored. */
  receivedQty: number
}

/** Units still to be delivered against an approved line. Never negative. */
export function outstandingForLine(p: LineProgress): number {
  return Math.max(0, p.approvedQty - p.receivedQty)
}

/** The status a line takes as purchase orders are raised and deliveries arrive. */
export function deriveItemProgressStatus(p: LineProgress): StockRequestItemStatus {
  if (p.approvedQty <= 0) return 'REJECTED'
  if (p.receivedQty >= p.approvedQty) return 'RECEIVED'
  if (p.receivedQty > 0) return 'PARTIALLY_RECEIVED'
  if (p.orderedQty > 0) return 'ORDERED'
  return 'APPROVED'
}

/**
 * The request status implied by the progress of its lines.
 *
 * Rejected lines are ignored throughout: a request whose only outstanding line was
 * rejected is complete once the approved ones arrive, not stuck forever.
 */
export function deriveRequestProgressStatus(
  lines: readonly LineProgress[],
  current: StockRequestStatus
): StockRequestStatus {
  const live = lines.filter((l) => l.approvedQty > 0)
  if (live.length === 0) return current

  if (live.every((l) => l.receivedQty >= l.approvedQty)) return 'COMPLETED'
  if (live.some((l) => l.receivedQty > 0)) return 'PARTIALLY_RECEIVED'
  if (live.every((l) => l.orderedQty >= l.approvedQty)) return 'ORDERED'
  if (live.some((l) => l.orderedQty > 0)) return 'ORDERED'
  return current
}

// ---------------------------------------------------------------------------
// Receiving a purchase order
// ---------------------------------------------------------------------------

/** The purchase order fields the receive rules need. */
export interface ReceivableOrder {
  status: string
  qty: number
  receivedQty: number
}

/** Statuses a delivery may be booked against. */
export const RECEIVABLE_PO_STATUSES = ['ORDERED', 'PARTIALLY_RECEIVED'] as const

/** Units still expected on a purchase order. Never negative. */
export function remainingToReceive(po: ReceivableOrder): number {
  return Math.max(0, po.qty - po.receivedQty)
}

/**
 * Resolve and check the quantity for one delivery.
 *
 * `requested` omitted means "everything still outstanding", which is what the
 * receive endpoint did before it understood partial deliveries — so every existing
 * caller keeps its exact behaviour.
 *
 * This is a pre-check for a clear error message, not the guarantee. The guarantee is
 * the conditional claim in the route, which re-asserts the same bound atomically.
 */
export function resolveReceiptQty(
  po: ReceivableOrder,
  requested?: number | null
): { error: string } | { qty: number } {
  if (!RECEIVABLE_PO_STATUSES.includes(po.status as (typeof RECEIVABLE_PO_STATUSES)[number])) {
    return {
      error:
        po.status === 'RECEIVED'
          ? 'This purchase order has already been received in full'
          : 'Only ordered purchase orders can be received',
    }
  }

  const remaining = remainingToReceive(po)
  if (remaining <= 0) return { error: 'This purchase order has already been received in full' }

  if (requested === undefined || requested === null) return { qty: remaining }

  if (!Number.isInteger(requested)) return { error: 'Received quantity must be a whole number' }
  if (requested < 1) return { error: 'Received quantity must be at least 1' }
  if (requested > remaining) {
    return {
      error: `Only ${remaining} of the ${po.qty} ordered ${remaining === 1 ? 'unit is' : 'units are'} still outstanding. Enter ${remaining} or fewer.`,
    }
  }

  return { qty: requested }
}

/** The status a purchase order takes once this delivery is booked in. */
export function nextPoStatus(po: ReceivableOrder, receiptQty: number): 'PARTIALLY_RECEIVED' | 'RECEIVED' {
  return po.receivedQty + receiptQty >= po.qty ? 'RECEIVED' : 'PARTIALLY_RECEIVED'
}

/**
 * The exact `receivedQty` the receive claim must match for this delivery to land.
 *
 * An upper bound (`receivedQty: { lte: qty - receiptQty }`) is enough to refuse
 * over-receipt, but not enough to be correct: `nextPoStatus` is computed from the
 * row as it was read, so if another delivery lands in between, a purchase order can
 * reach 100 of 100 and still be written as PARTIALLY_RECEIVED. Pinning the exact
 * value read makes the claim a true optimistic lock — the same idiom as
 * `updateMedicineWithStockGuard`, which claims `where: { id, stock: previousStock }`.
 *
 * The loser of a race writes nothing and is told to retry, which is the right
 * outcome for what is almost always a double-click at a receiving counter.
 */
export function receiptClaimReceivedQty(po: ReceivableOrder): number {
  return po.receivedQty
}
