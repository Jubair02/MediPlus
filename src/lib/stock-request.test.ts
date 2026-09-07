import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  SR_TRANSITIONS,
  canTransition,
  deriveItemProgressStatus,
  deriveItemStatusAfterReview,
  deriveRequestProgressStatus,
  deriveRequestStatusAfterReview,
  isEditable,
  isReviewable,
  nextPoStatus,
  outstandingForLine,
  receiptClaimReceivedQty,
  remainingToReceive,
  resolveReceiptQty,
  validateApproval,
  type ApprovalDecision,
  type ReceivableOrder,
  type RequestLine,
} from './stock-request.ts'

/**
 * These rules decide when stock is allowed to move, so they are tested directly
 * rather than through a route. The last block simulates the conditional claim the
 * receive path issues, because "over-receipt is refused" is the property the whole
 * partial-delivery design rests on.
 */

const line = (id: string, requestedQty: number, approvedQty: number | null = null): RequestLine => ({
  id,
  requestedQty,
  approvedQty,
})

describe('SR_TRANSITIONS', () => {
  it('never allows a decided request back into review', () => {
    assert.equal(canTransition('APPROVED', 'UNDER_REVIEW'), false)
    assert.equal(canTransition('REJECTED', 'UNDER_REVIEW'), false)
    assert.equal(canTransition('PARTIALLY_APPROVED', 'UNDER_REVIEW'), false)
  })

  it('never allows a rejected request to become approved', () => {
    assert.equal(canTransition('REJECTED', 'APPROVED'), false)
    assert.equal(canTransition('REJECTED', 'PARTIALLY_APPROVED'), false)
    assert.equal(canTransition('REJECTED', 'ORDERED'), false)
  })

  it('allows the normal path end to end', () => {
    const path = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED', 'COMPLETED'] as const
    for (let i = 0; i < path.length - 1; i++) {
      assert.ok(canTransition(path[i], path[i + 1]), `${path[i]} → ${path[i + 1]} should be legal`)
    }
  })

  it('treats a repeat partial delivery as a legal same-state move', () => {
    assert.ok(canTransition('PARTIALLY_RECEIVED', 'PARTIALLY_RECEIVED'))
  })

  it('refuses to skip review', () => {
    assert.equal(canTransition('DRAFT', 'APPROVED'), false)
    assert.equal(canTransition('DRAFT', 'UNDER_REVIEW'), false)
    assert.equal(canTransition('SUBMITTED', 'APPROVED'), false)
  })

  it('refuses to order or receive anything that was never approved', () => {
    assert.equal(canTransition('SUBMITTED', 'ORDERED'), false)
    assert.equal(canTransition('UNDER_REVIEW', 'ORDERED'), false)
    assert.equal(canTransition('APPROVED', 'COMPLETED'), false, 'stock must be ordered before it can arrive')
  })

  it('has terminal end states', () => {
    assert.deepEqual([...SR_TRANSITIONS.COMPLETED], [])
    assert.deepEqual([...SR_TRANSITIONS.CANCELLED], [])
    assert.deepEqual([...SR_TRANSITIONS.REJECTED], [])
  })

  it('can be cancelled from anywhere that is not already finished', () => {
    for (const [from, to] of Object.entries(SR_TRANSITIONS)) {
      const finished = from === 'COMPLETED' || from === 'CANCELLED' || from === 'REJECTED'
      assert.equal(to.includes('CANCELLED'), !finished, `${from} cancellable?`)
    }
  })

  it('only a draft is editable, only a submitted or in-review request is reviewable', () => {
    assert.ok(isEditable('DRAFT'))
    assert.equal(isEditable('SUBMITTED'), false)
    assert.ok(isReviewable('SUBMITTED'))
    assert.ok(isReviewable('UNDER_REVIEW'))
    assert.equal(isReviewable('APPROVED'), false)
  })
})

describe('validateApproval', () => {
  const lines = [line('a', 100), line('b', 50), line('c', 100)]

  it('accepts a full approval', () => {
    const d: ApprovalDecision[] = [
      { itemId: 'a', approvedQty: 100 },
      { itemId: 'b', approvedQty: 50 },
      { itemId: 'c', approvedQty: 100 },
    ]
    assert.deepEqual(validateApproval(lines, d), { ok: true })
  })

  it('accepts cuts and rejections', () => {
    const d: ApprovalDecision[] = [
      { itemId: 'a', approvedQty: 100 },
      { itemId: 'b', approvedQty: 30 },
      { itemId: 'c', approvedQty: 0 },
    ]
    assert.deepEqual(validateApproval(lines, d), { ok: true })
  })

  it('refuses to approve more than was requested', () => {
    const r = validateApproval(lines, [
      { itemId: 'a', approvedQty: 101 },
      { itemId: 'b', approvedQty: 50 },
      { itemId: 'c', approvedQty: 100 },
    ])
    assert.ok('error' in r)
    assert.match(r.error, /cannot exceed the 100 requested/)
    assert.match(r.error, /new request/)
  })

  it('refuses negative and fractional quantities', () => {
    assert.ok('error' in validateApproval([line('a', 10)], [{ itemId: 'a', approvedQty: -1 }]))
    assert.ok('error' in validateApproval([line('a', 10)], [{ itemId: 'a', approvedQty: 2.5 }]))
  })

  it('refuses a half-finished review', () => {
    const r = validateApproval(lines, [{ itemId: 'a', approvedQty: 100 }])
    assert.ok('error' in r)
    assert.match(r.error, /2 items have not been decided/)
  })

  it('names the singular case properly', () => {
    const r = validateApproval(lines, [
      { itemId: 'a', approvedQty: 100 },
      { itemId: 'b', approvedQty: 50 },
    ])
    assert.ok('error' in r)
    assert.match(r.error, /One item has not been decided/)
  })

  it('refuses a decision for an item that is not on the request', () => {
    const r = validateApproval(lines, [
      { itemId: 'a', approvedQty: 1 },
      { itemId: 'b', approvedQty: 1 },
      { itemId: 'c', approvedQty: 1 },
      { itemId: 'zzz', approvedQty: 1 },
    ])
    assert.ok('error' in r)
    assert.match(r.error, /does not contain/)
  })

  it('refuses the same item decided twice', () => {
    const r = validateApproval(lines, [
      { itemId: 'a', approvedQty: 100 },
      { itemId: 'a', approvedQty: 50 },
      { itemId: 'b', approvedQty: 50 },
      { itemId: 'c', approvedQty: 100 },
    ])
    assert.ok('error' in r)
    assert.match(r.error, /decided twice/)
  })

  it('refuses a request with no items', () => {
    assert.ok('error' in validateApproval([], []))
  })
})

describe('status derived from a review', () => {
  it('is APPROVED only when every line was approved in full', () => {
    const lines = [line('a', 100, 100), line('b', 50, 50)]
    assert.equal(deriveRequestStatusAfterReview(lines), 'APPROVED')
  })

  it('is REJECTED when nothing was approved', () => {
    const lines = [line('a', 100, 0), line('b', 50, 0)]
    assert.equal(deriveRequestStatusAfterReview(lines), 'REJECTED')
  })

  it('handles the worked example: Napa 100/100, Seclo 30/50, Vitamin C 0/100', () => {
    const lines = [line('napa', 100, 100), line('seclo', 50, 30), line('vitc', 100, 0)]
    assert.equal(deriveRequestStatusAfterReview(lines), 'PARTIALLY_APPROVED')
    assert.equal(deriveItemStatusAfterReview(lines[0]), 'APPROVED')
    assert.equal(deriveItemStatusAfterReview(lines[1]), 'PARTIALLY_APPROVED')
    assert.equal(deriveItemStatusAfterReview(lines[2]), 'REJECTED')
  })

  it('is PARTIALLY_APPROVED when a single line was merely cut', () => {
    assert.equal(deriveRequestStatusAfterReview([line('a', 100, 99)]), 'PARTIALLY_APPROVED')
  })

  it('leaves an undecided line PENDING', () => {
    assert.equal(deriveItemStatusAfterReview(line('a', 10, null)), 'PENDING')
  })
})

describe('status derived from progress', () => {
  const p = (approvedQty: number, orderedQty: number, receivedQty: number) => ({ approvedQty, orderedQty, receivedQty })

  it('stays put while nothing has been ordered', () => {
    assert.equal(deriveRequestProgressStatus([p(100, 0, 0)], 'APPROVED'), 'APPROVED')
  })

  it('is ORDERED once purchase orders cover the approved lines', () => {
    assert.equal(deriveRequestProgressStatus([p(100, 100, 0), p(30, 30, 0)], 'APPROVED'), 'ORDERED')
  })

  it('is PARTIALLY_RECEIVED as soon as any delivery arrives', () => {
    assert.equal(deriveRequestProgressStatus([p(100, 100, 60), p(30, 30, 0)], 'ORDERED'), 'PARTIALLY_RECEIVED')
  })

  it('is COMPLETED only when every approved line is fully received', () => {
    assert.equal(deriveRequestProgressStatus([p(100, 100, 100), p(30, 30, 30)], 'PARTIALLY_RECEIVED'), 'COMPLETED')
  })

  it('ignores rejected lines, so a request is not stuck open forever', () => {
    // Vitamin C was rejected; the request completes when Napa and Seclo arrive.
    const lines = [p(100, 100, 100), p(30, 30, 30), p(0, 0, 0)]
    assert.equal(deriveRequestProgressStatus(lines, 'PARTIALLY_RECEIVED'), 'COMPLETED')
  })

  it('derives per-line status across the whole journey', () => {
    assert.equal(deriveItemProgressStatus(p(100, 0, 0)), 'APPROVED')
    assert.equal(deriveItemProgressStatus(p(100, 100, 0)), 'ORDERED')
    assert.equal(deriveItemProgressStatus(p(100, 100, 60)), 'PARTIALLY_RECEIVED')
    assert.equal(deriveItemProgressStatus(p(100, 100, 100)), 'RECEIVED')
    assert.equal(deriveItemProgressStatus(p(0, 0, 0)), 'REJECTED')
  })

  it('counts an over-delivery as received, not as still outstanding', () => {
    assert.equal(deriveItemProgressStatus(p(100, 100, 120)), 'RECEIVED')
    assert.equal(outstandingForLine(p(100, 100, 120)), 0)
  })

  it('reports what is still outstanding on a line', () => {
    assert.equal(outstandingForLine(p(100, 100, 60)), 40)
    assert.equal(outstandingForLine(p(100, 0, 0)), 100)
  })
})

describe('resolveReceiptQty', () => {
  const po = (qty: number, receivedQty: number, status = 'ORDERED'): ReceivableOrder => ({ qty, receivedQty, status })

  it('defaults to everything outstanding, so existing callers are unchanged', () => {
    assert.deepEqual(resolveReceiptQty(po(100, 0)), { qty: 100 })
    assert.deepEqual(resolveReceiptQty(po(100, 60, 'PARTIALLY_RECEIVED')), { qty: 40 })
    assert.deepEqual(resolveReceiptQty(po(100, 0), null), { qty: 100 })
  })

  it('accepts a partial delivery', () => {
    assert.deepEqual(resolveReceiptQty(po(100, 0), 60), { qty: 60 })
    assert.deepEqual(resolveReceiptQty(po(100, 60, 'PARTIALLY_RECEIVED'), 40), { qty: 40 })
  })

  it('refuses more than is outstanding, and says how many are', () => {
    const r = resolveReceiptQty(po(100, 60, 'PARTIALLY_RECEIVED'), 41)
    assert.ok('error' in r)
    assert.match(r.error, /Only 40 of the 100 ordered units are still outstanding/)
  })

  it('refuses a third delivery once the order is complete', () => {
    const r = resolveReceiptQty(po(100, 100, 'RECEIVED'), 1)
    assert.ok('error' in r)
    assert.match(r.error, /already been received in full/)
  })

  it('refuses to receive against a cancelled order', () => {
    const r = resolveReceiptQty(po(100, 0, 'CANCELLED'), 10)
    assert.ok('error' in r)
    assert.match(r.error, /Only ordered purchase orders/)
  })

  it('refuses zero, negative and fractional quantities', () => {
    assert.ok('error' in resolveReceiptQty(po(100, 0), 0))
    assert.ok('error' in resolveReceiptQty(po(100, 0), -5))
    assert.ok('error' in resolveReceiptQty(po(100, 0), 1.5))
  })

  it('gets the singular wording right', () => {
    const r = resolveReceiptQty(po(100, 99, 'PARTIALLY_RECEIVED'), 2)
    assert.ok('error' in r)
    assert.match(r.error, /Only 1 of the 100 ordered unit is still outstanding/)
  })
})

describe('nextPoStatus', () => {
  it('is RECEIVED when this delivery completes the order', () => {
    assert.equal(nextPoStatus({ qty: 100, receivedQty: 60, status: 'PARTIALLY_RECEIVED' }, 40), 'RECEIVED')
    assert.equal(nextPoStatus({ qty: 100, receivedQty: 0, status: 'ORDERED' }, 100), 'RECEIVED')
  })

  it('is PARTIALLY_RECEIVED while anything is still outstanding', () => {
    assert.equal(nextPoStatus({ qty: 100, receivedQty: 0, status: 'ORDERED' }, 60), 'PARTIALLY_RECEIVED')
    assert.equal(nextPoStatus({ qty: 100, receivedQty: 60, status: 'PARTIALLY_RECEIVED' }, 39), 'PARTIALLY_RECEIVED')
  })
})

/**
 * The route claims the purchase order row with
 *
 *   where: { id, status: { in: RECEIVABLE }, receivedQty: receiptClaimReceivedQty(po) }
 *   data:  { receivedQty: { increment: qty }, status: nextPoStatus(po, qty) }
 *
 * `claim` mirrors those conditions so the guarantee can be exercised without a
 * database. `seenBy` is the row as the request read it — the whole point of an
 * optimistic lock is that the claim is judged against that snapshot, not against
 * whatever the row happens to be now.
 */
interface Row {
  id: string
  qty: number
  receivedQty: number
  status: string
}
const RECEIVABLE_STATUSES = ['ORDERED', 'PARTIALLY_RECEIVED'] as const

function claim(row: Row, receiptQty: number, seenBy: ReceivableOrder): { count: number } {
  const matches =
    (RECEIVABLE_STATUSES as readonly string[]).includes(row.status) &&
    row.receivedQty === receiptClaimReceivedQty(seenBy)
  if (!matches) return { count: 0 }
  row.receivedQty += receiptQty
  // Status is computed from the snapshot the request read, exactly as the route does.
  row.status = nextPoStatus(seenBy, receiptQty)
  return { count: 1 }
}

describe('the conditional claim that refuses over-receipt', () => {
  const fresh = (): Row => ({ id: 'po1', qty: 100, receivedQty: 0, status: 'ORDERED' })

  it('books a partial delivery and leaves the order open', () => {
    const row = fresh()
    assert.equal(claim(row, 60, { ...row }).count, 1)
    assert.equal(row.receivedQty, 60)
    assert.equal(row.status, 'PARTIALLY_RECEIVED')
  })

  it('completes the order on the second delivery: 60 then 40', () => {
    const row = fresh()
    claim(row, 60, { ...row })
    assert.equal(claim(row, 40, { ...row }).count, 1)
    assert.equal(row.receivedQty, 100)
    assert.equal(row.status, 'RECEIVED')
  })

  it('refuses a third delivery of 1 after 60 + 40', () => {
    const row = fresh()
    claim(row, 60, { ...row })
    claim(row, 40, { ...row })
    // resolveReceiptQty refuses it before the claim is even attempted.
    const r = resolveReceiptQty(row, 1)
    assert.ok('error' in r)
    assert.match(r.error, /already been received in full/)
  })

  it('lets only one of two concurrent identical deliveries land', () => {
    // Both requests read the same row, then both try to claim 60 of 100.
    const row = fresh()
    const readByBoth: ReceivableOrder = { ...row }
    assert.equal(claim(row, 60, readByBoth).count, 1)
    assert.equal(claim(row, 60, readByBoth).count, 0, 'the loser of a race must write nothing')
    assert.equal(row.receivedQty, 60, 'one delivery, counted once')
  })

  it('refuses a concurrent delivery rather than mis-stating the status', () => {
    // This is the case a `lte` bound would get wrong: A reads 0/100 and wants 60,
    // B lands 40 first. Under `lte` A would still pass and write 100/100 while
    // stamping the status PARTIALLY_RECEIVED, computed from its stale snapshot.
    const row = fresh()
    const readByA: ReceivableOrder = { ...row }
    assert.equal(claim(row, 40, { ...row }).count, 1) // B lands first
    assert.equal(row.receivedQty, 40)

    assert.equal(claim(row, 60, readByA).count, 0, 'A must lose, having read a stale row')
    assert.equal(row.receivedQty, 40, 'nothing written')
    assert.equal(row.status, 'PARTIALLY_RECEIVED')

    // A retries against a fresh read and now succeeds, ending correctly.
    assert.equal(claim(row, 60, { ...row }).count, 1)
    assert.equal(row.receivedQty, 100)
    assert.equal(row.status, 'RECEIVED', 'status must be RECEIVED at 100 of 100')
  })

  it('never lets receivedQty pass the ordered quantity', () => {
    const row = fresh()
    let landed = 0
    for (let i = 0; i < 10; i++) {
      const r = resolveReceiptQty(row, 30)
      if ('error' in r) continue
      if (claim(row, r.qty, { ...row }).count === 1) landed++
    }
    assert.equal(landed, 3, 'only 3 × 30 fits inside 100')
    assert.equal(row.receivedQty, 90)
    assert.ok(row.receivedQty <= row.qty)
  })

  it('agrees with resolveReceiptQty about what is left', () => {
    const row = fresh()
    claim(row, 60, { ...row })
    assert.equal(remainingToReceive(row), 40)
    assert.deepEqual(resolveReceiptQty(row), { qty: 40 })
  })
})
