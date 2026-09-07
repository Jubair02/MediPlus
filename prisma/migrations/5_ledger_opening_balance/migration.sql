-- ---------------------------------------------------------------------------
-- Ledger opening balances (data-only migration — no schema change).
--
-- The stock ledger has never balanced. `prisma/seed.ts` wrote Medicine.stock
-- directly without a matching StockMovement, so 27 of 28 medicines fail the
-- invariant SUM(delta) = stock and 15 of them hold units with no ledger row at
-- all. While that is true the Stock Log cannot explain any stock figure, and
-- shrinkage is undetectable by construction: there is no arithmetic that would
-- reveal missing units.
--
-- This inserts exactly one OPENING movement per medicine whose ledger does not
-- add up, for the difference. After it, SUM(delta) = stock for every medicine,
-- and the reconciliation script (npm run db:reconcile) can assert that forever.
--
-- Two deliberate choices, both about honesty:
--
--   * Medicine.stock is NOT touched. The physical count is the fact of record;
--     the ledger is what is wrong, so the ledger is what gets the entry. A
--     migration that "corrected" stock would move inventory on paper that
--     nobody moved in the pharmacy.
--
--   * The row is dated at the medicine's createdAt, not today, so a running
--     balance is correct at every point in time and the entry reads as what it
--     mostly is — the balance the medicine started with. Where later drift is
--     mixed in (a purchase order marked received without a movement, for
--     instance) that cannot be separated from opening stock after the fact, so
--     the note states plainly that this is a reconciliation of unexplained
--     difference and names the date it was applied. Nothing is hidden: every
--     one of these rows is visible in the Stock Log as "Opening balance".
--
-- userId is left NULL: no person performed this, it is a system reconciliation.
-- ---------------------------------------------------------------------------

INSERT INTO "StockMovement" ("id", "medicineId", "userId", "delta", "reason", "note", "createdAt")
SELECT
  'smo_' || replace(gen_random_uuid()::text, '-', ''),
  m."id",
  NULL,
  (m."stock" - COALESCE(agg.s, 0))::int,
  'OPENING',
  'Opening balance reconciliation applied 2026-09-07: '
    || (m."stock" - COALESCE(agg.s, 0))::text
    || ' units were unaccounted for by the ledger. Not a physical stock change.',
  m."createdAt"
FROM "Medicine" m
LEFT JOIN (
  SELECT "medicineId", SUM("delta") AS s
  FROM "StockMovement"
  GROUP BY "medicineId"
) agg ON agg."medicineId" = m."id"
WHERE m."stock" <> COALESCE(agg.s, 0);
