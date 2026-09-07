-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "receivedQty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "stockRequestItemId" TEXT;

-- CreateTable
CREATE TABLE "PurchaseOrderReceipt" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "receivedById" TEXT,
    "note" TEXT,
    "batchNo" TEXT,
    "expiryDate" TIMESTAMP(3),
    "costPerUnit" DOUBLE PRECISION,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrderReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseOrderReceipt_purchaseOrderId_idx" ON "PurchaseOrderReceipt"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "PurchaseOrderReceipt_receivedAt_idx" ON "PurchaseOrderReceipt"("receivedAt");

-- CreateIndex
CREATE INDEX "PurchaseOrderReceipt_receivedById_idx" ON "PurchaseOrderReceipt"("receivedById");

-- CreateIndex
CREATE INDEX "PurchaseOrder_stockRequestItemId_idx" ON "PurchaseOrder"("stockRequestItemId");

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_stockRequestItemId_fkey" FOREIGN KEY ("stockRequestItemId") REFERENCES "StockRequestItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderReceipt" ADD CONSTRAINT "PurchaseOrderReceipt_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderReceipt" ADD CONSTRAINT "PurchaseOrderReceipt_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Backfill (hand-written; `migrate diff` only knows about structure).
--
-- Before receipt tracking existed, receiving was all-or-nothing, so a purchase
-- order marked RECEIVED had received exactly its ordered quantity. Both statements
-- below make that history true under the new model. Without them every historic
-- purchase order would read as "0 of N received", and the invariant
-- `receivedQty = SUM(receipts.qty)` would be false for every one of them from the
-- moment the reconciliation check is introduced.
--
-- ORDERED and CANCELLED purchase orders are correctly left at the default 0.
-- ---------------------------------------------------------------------------

-- Backfill 1: a RECEIVED purchase order received its full ordered quantity.
UPDATE "PurchaseOrder" SET "receivedQty" = "qty" WHERE "status" = 'RECEIVED';

-- Backfill 2: one synthesised receipt per historic delivery, so the invariant
-- holds from day one. The 'por_' prefix keeps these visibly distinct from cuids,
-- and gen_random_uuid() is core Postgres 13+ so no extension is required.
INSERT INTO "PurchaseOrderReceipt"
  ("id", "purchaseOrderId", "qty", "receivedById", "note", "receivedAt")
SELECT
  'por_' || replace(gen_random_uuid()::text, '-', ''),
  po."id",
  po."qty",
  po."receivedById",
  'Backfilled: received before per-delivery receipt tracking existed',
  COALESCE(po."receivedAt", po."updatedAt")
FROM "PurchaseOrder" po
WHERE po."status" = 'RECEIVED';

