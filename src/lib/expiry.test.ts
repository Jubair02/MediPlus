import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  ExpiredMedicineError,
  expiredSaleMessage,
  isExpired,
  notExpiredFilter,
  startOfToday,
} from './expiry.ts'

/**
 * Run with `npm test` (Node's built-in runner — no test dependency).
 *
 * The expiry rule guards a patient-safety hole: before it existed, a medicine past
 * its expiry date was an ordinary sellable product at all three points where stock
 * is committed. The rule is pure so it can be tested here directly, and the last
 * block below re-tests it through a stand-in for the conditional claim the routes
 * actually issue.
 */

const d = (iso: string) => new Date(iso)

describe('startOfToday', () => {
  it('collapses a timestamp to local midnight of the same day', () => {
    const noon = new Date(2026, 8, 7, 12, 34, 56, 789)
    const cutoff = startOfToday(noon)
    assert.equal(cutoff.getFullYear(), 2026)
    assert.equal(cutoff.getMonth(), 8)
    assert.equal(cutoff.getDate(), 7)
    assert.equal(cutoff.getHours(), 0)
    assert.equal(cutoff.getMinutes(), 0)
    assert.equal(cutoff.getSeconds(), 0)
    assert.equal(cutoff.getMilliseconds(), 0)
  })

  it('does not mutate the date it is given', () => {
    const now = new Date(2026, 8, 7, 12, 0, 0)
    const before = now.getTime()
    startOfToday(now)
    assert.equal(now.getTime(), before)
  })
})

describe('isExpired', () => {
  const asOf = startOfToday(new Date(2026, 8, 7, 9, 0, 0)) // 7 Sep 2026, local midnight

  it('treats a medicine with no expiry date as never expired', () => {
    assert.equal(isExpired(null, asOf), false)
    assert.equal(isExpired(undefined, asOf), false)
  })

  it('is not expired on its expiry date — a pack is in date all day', () => {
    assert.equal(isExpired(new Date(2026, 8, 7, 0, 0, 0), asOf), false)
    assert.equal(isExpired(new Date(2026, 8, 7, 23, 59, 59), asOf), false)
  })

  it('is expired the day after its expiry date', () => {
    assert.equal(isExpired(new Date(2026, 8, 6, 23, 59, 59), asOf), true)
    assert.equal(isExpired(new Date(2026, 8, 6, 0, 0, 0), asOf), true)
  })

  it('is not expired for a future date', () => {
    assert.equal(isExpired(new Date(2026, 8, 8), asOf), false)
    assert.equal(isExpired(new Date(2027, 0, 1), asOf), false)
  })

  it('holds steady across the working day', () => {
    // The cutoff is derived once per request from the start of the day, so the same
    // medicine cannot be sellable in the morning and unsellable in the afternoon.
    const morning = startOfToday(new Date(2026, 8, 7, 8, 0, 0))
    const evening = startOfToday(new Date(2026, 8, 7, 20, 0, 0))
    const expiry = new Date(2026, 8, 7, 0, 0, 0)
    assert.equal(isExpired(expiry, morning), isExpired(expiry, evening))
  })

  it('flags the row this fix was written for', () => {
    // Savoy Ointment 20g: ACTIVE, 110 units, expiryDate 2026-08-22, no prescription
    // required — sellable until this rule existed.
    const savoy = d('2026-08-22T00:00:00.000Z')
    assert.equal(isExpired(savoy, startOfToday(d('2026-09-07T12:00:00.000Z'))), true)
  })

  it('does not flag a medicine expiring later this year', () => {
    const napa = d('2027-02-01T00:00:00.000Z')
    assert.equal(isExpired(napa, startOfToday(d('2026-09-07T12:00:00.000Z'))), false)
  })
})

describe('notExpiredFilter', () => {
  const asOf = new Date(2026, 8, 7)

  it('admits a null expiry date or one on/after the cutoff', () => {
    assert.deepEqual(notExpiredFilter(asOf), {
      OR: [{ expiryDate: null }, { expiryDate: { gte: asOf } }],
    })
  })

  it('spreads into a stock claim without displacing the other conditions', () => {
    const claim = { id: 'med_1', stock: { gte: 3 }, ...notExpiredFilter(asOf) }
    assert.equal(claim.id, 'med_1')
    assert.deepEqual(claim.stock, { gte: 3 })
    assert.ok(Array.isArray(claim.OR))
    assert.equal(claim.OR.length, 2)
  })
})

describe('expiredSaleMessage', () => {
  it('names the single offending medicine and says what to do', () => {
    const msg = expiredSaleMessage(['Savoy Ointment 20g'])
    assert.match(msg, /Savoy Ointment 20g/)
    assert.match(msg, /passed its expiry date/)
    assert.match(msg, /Remove it from the order/)
  })

  it('counts and names every offending medicine', () => {
    const msg = expiredSaleMessage(['Savoy Ointment 20g', 'Ace 500mg'])
    assert.match(msg, /^2 items/)
    assert.match(msg, /Savoy Ointment 20g/)
    assert.match(msg, /Ace 500mg/)
    assert.match(msg, /Remove them from the order/)
  })

  it('does not repeat a medicine that appears on two order lines', () => {
    const msg = expiredSaleMessage(['Ace 500mg', 'Ace 500mg'])
    assert.match(msg, /^Ace 500mg has passed/)
    assert.equal(msg.match(/Ace 500mg/g)?.length, 1)
  })

  it('still says something useful with no names', () => {
    const msg = expiredSaleMessage([])
    assert.match(msg, /expiry date/)
    assert.ok(msg.length > 0)
  })
})

describe('ExpiredMedicineError', () => {
  it('is an Error carrying the names and the user-facing message', () => {
    const err = new ExpiredMedicineError(['Savoy Ointment 20g'])
    assert.ok(err instanceof Error)
    assert.ok(err instanceof ExpiredMedicineError)
    assert.equal(err.name, 'ExpiredMedicineError')
    assert.deepEqual([...err.medicineNames], ['Savoy Ointment 20g'])
    assert.equal(err.message, expiredSaleMessage(['Savoy Ointment 20g']))
  })
})

/**
 * The three commitment points all issue the same shape of conditional claim:
 *
 *   updateMany({ where: { id, stock: { gte: qty }, ...notExpiredFilter(asOf) },
 *               data:  { stock: { decrement: qty } } })
 *
 * `claim` below is a stand-in that applies those conditions the way Postgres would,
 * so the guard can be exercised without a database. It models Prisma rather than
 * being Prisma — what it verifies is that the predicate we build actually rejects
 * expired rows while leaving the existing quantity guard intact.
 */
interface Row {
  id: string
  name: string
  stock: number
  expiryDate: Date | null
}

/** The clause shape `notExpiredFilter` produces, stated locally so the test can read it
 *  back without wrestling Prisma's generated union types. */
type ExpiryClause = { expiryDate: null | { gte: Date } }

function claim(rows: Row[], medicineId: string, quantity: number, asOf: Date): { count: number } {
  const clauses = (notExpiredFilter(asOf).OR ?? []) as ReadonlyArray<ExpiryClause>
  const matched = rows.filter(
    (r) =>
      r.id === medicineId &&
      r.stock >= quantity &&
      clauses.some((clause) =>
        clause.expiryDate === null
          ? r.expiryDate === null
          : r.expiryDate !== null && r.expiryDate.getTime() >= clause.expiryDate.gte.getTime()
      )
  )
  for (const r of matched) r.stock -= quantity
  return { count: matched.length }
}

/** Mirrors the failure branch each route runs when a claim matches nothing. */
function explain(rows: Row[], medicineId: string, name: string, asOf: Date): Error {
  const current = rows.find((r) => r.id === medicineId)
  if (isExpired(current?.expiryDate, asOf)) return new ExpiredMedicineError([name])
  return new Error(`Insufficient stock for ${name}`)
}

describe('the conditional claim used at every commitment point', () => {
  const asOf = startOfToday(new Date(2026, 8, 7, 10, 0, 0))

  const fresh = (): Row[] => [
    { id: 'ok', name: 'Ace 500mg', stock: 50, expiryDate: new Date(2027, 1, 1) },
    { id: 'expired', name: 'Savoy Ointment 20g', stock: 110, expiryDate: new Date(2026, 7, 22) },
    { id: 'today', name: 'Fexo 120mg', stock: 20, expiryDate: new Date(2026, 8, 7) },
    { id: 'noexpiry', name: 'Sodium Bicarbonate BP', stock: 398, expiryDate: null },
    { id: 'thin', name: 'Amoxin 500mg', stock: 2, expiryDate: new Date(2027, 1, 1) },
  ]

  it('commits stock for an in-date medicine', () => {
    const rows = fresh()
    assert.equal(claim(rows, 'ok', 3, asOf).count, 1)
    assert.equal(rows.find((r) => r.id === 'ok')!.stock, 47)
  })

  it('refuses to commit stock for an expired medicine, and takes none', () => {
    const rows = fresh()
    assert.equal(claim(rows, 'expired', 1, asOf).count, 0)
    assert.equal(rows.find((r) => r.id === 'expired')!.stock, 110, 'stock must be untouched')
  })

  it('reports an expired medicine as expired, not as out of stock', () => {
    const rows = fresh()
    claim(rows, 'expired', 1, asOf)
    const err = explain(rows, 'expired', 'Savoy Ointment 20g', asOf)
    assert.ok(err instanceof ExpiredMedicineError)
    assert.match(err.message, /Savoy Ointment 20g/)
  })

  it('commits stock on the medicine’s own expiry date', () => {
    const rows = fresh()
    assert.equal(claim(rows, 'today', 5, asOf).count, 1)
    assert.equal(rows.find((r) => r.id === 'today')!.stock, 15)
  })

  it('commits stock for a medicine with no expiry date recorded', () => {
    const rows = fresh()
    assert.equal(claim(rows, 'noexpiry', 10, asOf).count, 1)
    assert.equal(rows.find((r) => r.id === 'noexpiry')!.stock, 388)
  })

  it('still enforces the quantity guard, and still calls that a stock failure', () => {
    const rows = fresh()
    assert.equal(claim(rows, 'thin', 5, asOf).count, 0)
    assert.equal(rows.find((r) => r.id === 'thin')!.stock, 2)
    const err = explain(rows, 'thin', 'Amoxin 500mg', asOf)
    assert.ok(!(err instanceof ExpiredMedicineError))
    assert.match(err.message, /Insufficient stock/)
  })

  it('never drives stock negative under repeated claims', () => {
    const rows = fresh()
    let committed = 0
    for (let i = 0; i < 5; i++) {
      if (claim(rows, 'thin', 1, asOf).count === 1) committed++
    }
    assert.equal(committed, 2, 'only the two units that existed may be committed')
    assert.equal(rows.find((r) => r.id === 'thin')!.stock, 0)
  })

  it('blocks an expired line without blocking the in-date lines beside it', () => {
    // A mixed order: the sweep before the transaction is what reports every expired
    // line at once, so check that shape too.
    const rows = fresh()
    const order = [
      { id: 'ok', name: 'Ace 500mg', quantity: 2 },
      { id: 'expired', name: 'Savoy Ointment 20g', quantity: 1 },
      { id: 'today', name: 'Fexo 120mg', quantity: 1 },
    ]
    const expiredNames = order
      .filter((line) => isExpired(rows.find((r) => r.id === line.id)!.expiryDate, asOf))
      .map((line) => line.name)

    assert.deepEqual(expiredNames, ['Savoy Ointment 20g'])
    assert.match(expiredSaleMessage(expiredNames), /Savoy Ointment 20g/)
    // The order is rejected as a whole, so nothing was decremented.
    assert.equal(rows.find((r) => r.id === 'ok')!.stock, 50)
    assert.equal(rows.find((r) => r.id === 'today')!.stock, 20)
  })
})
