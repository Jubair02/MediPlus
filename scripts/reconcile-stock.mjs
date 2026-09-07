/**
 * Inventory reconciliation — read-only. Run with `npm run db:reconcile`.
 *
 * Asserts the two invariants the inventory design rests on:
 *
 *   1. SUM(StockMovement.delta) == Medicine.stock, for every medicine.
 *      The ledger must be able to explain the number on the shelf. This held for
 *      only 1 of 28 medicines before the opening-balance backfill.
 *
 *   2. PurchaseOrder.receivedQty == SUM(its receipts' qty), for every purchase
 *      order. receivedQty is the one derived quantity stored rather than summed,
 *      because over-receipt has to be refused atomically — so it needs checking.
 *
 * Plus two safety properties that should never be violated: no negative stock,
 * and no receipt exceeding its purchase order's ordered quantity.
 *
 * Exits non-zero on any violation, so it can gate a deploy. It is NOT part of
 * `npm run check`, which must keep working without database access.
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
let failures = 0

function report(pass, label, detail) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`)
  if (!pass) {
    failures++
    if (detail) console.log(detail)
  }
}

try {
  // ---- 1. ledger balances ----
  const ledgerDrift = await db.$queryRawUnsafe(`
    SELECT m."id", m."name", m."stock", COALESCE(agg.s, 0)::int AS ledger,
           (m."stock" - COALESCE(agg.s, 0))::int AS drift
      FROM "Medicine" m
      LEFT JOIN (SELECT "medicineId", SUM("delta") AS s FROM "StockMovement" GROUP BY "medicineId") agg
        ON agg."medicineId" = m."id"
     WHERE m."stock" <> COALESCE(agg.s, 0)
     ORDER BY abs(m."stock" - COALESCE(agg.s, 0)) DESC`)
  report(
    ledgerDrift.length === 0,
    `SUM(StockMovement.delta) == Medicine.stock  (${ledgerDrift.length} medicine(s) adrift)`,
    ledgerDrift
      .slice(0, 15)
      .map((r) => `        ${String(r.drift).padStart(7)}  stock=${r.stock} ledger=${r.ledger}  ${r.name}`)
      .join('\n')
  )

  // ---- 2. purchase order receipts reconcile ----
  const poDrift = await db.$queryRawUnsafe(`
    SELECT po."id", po."status", po."qty", po."receivedQty",
           COALESCE(r.s, 0)::int AS receipts
      FROM "PurchaseOrder" po
      LEFT JOIN (SELECT "purchaseOrderId", SUM("qty") AS s FROM "PurchaseOrderReceipt" GROUP BY "purchaseOrderId") r
        ON r."purchaseOrderId" = po."id"
     WHERE po."receivedQty" <> COALESCE(r.s, 0)`)
  report(
    poDrift.length === 0,
    `PurchaseOrder.receivedQty == SUM(receipts.qty)  (${poDrift.length} purchase order(s) adrift)`,
    poDrift.map((r) => `        ${r.id}  receivedQty=${r.receivedQty} receipts=${r.receipts}`).join('\n')
  )

  // ---- 3. safety properties ----
  const negative = await db.medicine.findMany({ where: { stock: { lt: 0 } }, select: { name: true, stock: true } })
  report(
    negative.length === 0,
    `no negative stock  (${negative.length} row(s))`,
    negative.map((m) => `        ${m.stock}  ${m.name}`).join('\n')
  )

  const overReceived = await db.$queryRawUnsafe(
    `SELECT "id", "qty", "receivedQty" FROM "PurchaseOrder" WHERE "receivedQty" > "qty"`
  )
  report(
    overReceived.length === 0,
    `no purchase order received beyond its ordered quantity  (${overReceived.length} row(s))`,
    overReceived.map((r) => `        ${r.id}  ${r.receivedQty} of ${r.qty}`).join('\n')
  )

  // ---- context, not an assertion ----
  const [meds, movements, byReason] = await Promise.all([
    db.medicine.count(),
    db.stockMovement.count(),
    db.stockMovement.groupBy({ by: ['reason'], _count: true, _sum: { delta: true } }),
  ])
  const totalStock = await db.medicine.aggregate({ _sum: { stock: true } })
  console.log(`\n${meds} medicines · ${totalStock._sum.stock} units · ${movements} movements`)
  for (const r of byReason.sort((a, b) => b._count - a._count)) {
    console.log(`  ${r.reason.padEnd(14)} n=${String(r._count).padStart(4)}  net=${r._sum.delta}`)
  }

  console.log(failures === 0 ? '\nRECONCILED' : `\n${failures} INVARIANT(S) VIOLATED`)
} finally {
  await db.$disconnect()
}

process.exit(failures === 0 ? 0 : 1)
