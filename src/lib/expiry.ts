import type { Prisma } from '@prisma/client'

/**
 * The rule that decides whether a medicine may still be sold.
 *
 * Stock leaves inventory at three commitment points — checkout, prescription
 * approval and admin confirmation — and each one used to check only `status` and
 * `stock`, so an out-of-date medicine was an ordinary sellable product. The rule
 * has to be identical at all three, which is why it lives here as pure functions
 * with no runtime imports (the Prisma import is a type, erased at build) and is
 * unit-tested directly rather than through a route.
 *
 * A pack is in date for the whole of its expiry date, so "expired" means the date
 * is strictly before today. The cutoff is the start of the local day rather than
 * `new Date()` so a decision holds steady across a shift: an order that could be
 * confirmed at 09:00 does not become unconfirmable at 14:00 because the clock moved.
 */

/** Midnight at the start of today, local time — the cutoff every expiry date is judged against. */
export function startOfToday(now: Date = new Date()): Date {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * True when this expiry date has passed. A medicine with no expiry date recorded
 * never expires — absent data is not evidence of a problem, and blocking on it
 * would take most of the catalogue off sale.
 */
export function isExpired(expiryDate: Date | null | undefined, asOf: Date): boolean {
  if (!expiryDate) return false
  return expiryDate.getTime() < asOf.getTime()
}

/**
 * Prisma predicate for "in date as of `asOf`", to be ANDed into the conditional
 * stock claim at a commitment point. Folding expiry into the same `updateMany`
 * that guards quantity keeps the whole decision atomic: there is no window in
 * which a medicine passes the check and is then committed after expiring.
 */
export function notExpiredFilter(asOf: Date): Prisma.MedicineWhereInput {
  return { OR: [{ expiryDate: null }, { expiryDate: { gte: asOf } }] }
}

/** Every distinct name in `names`, order preserved. */
function distinct(names: readonly string[]): string[] {
  return [...new Set(names)]
}

/** User-facing message naming each expired item and what to do about it. */
export function expiredSaleMessage(names: readonly string[]): string {
  const unique = distinct(names)
  if (unique.length === 0) {
    return 'This order contains a medicine that has passed its expiry date and cannot be completed.'
  }
  if (unique.length === 1) {
    return `${unique[0]} has passed its expiry date and can no longer be sold. Remove it from the order to continue.`
  }
  return `${unique.length} items have passed their expiry date and can no longer be sold: ${unique.join(
    ', '
  )}. Remove them from the order to continue.`
}

/**
 * Raised when a sale is blocked because one or more items are out of date. Every
 * route that commits stock maps this to a 400 with the message above, so the
 * customer or staff member is told which medicine is the problem.
 */
export class ExpiredMedicineError extends Error {
  // Assigned explicitly rather than as a constructor parameter property: this module
  // is loaded directly by the Node test runner, whose strip-only TypeScript mode
  // erases types but cannot transform that syntax.
  readonly medicineNames: readonly string[]

  constructor(medicineNames: readonly string[]) {
    super(expiredSaleMessage(medicineNames))
    this.name = 'ExpiredMedicineError'
    this.medicineNames = medicineNames
  }
}
