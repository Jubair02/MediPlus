-- DropIndex
DROP INDEX "Order_prescriptionId_key";

-- CreateIndex
CREATE INDEX "Order_prescriptionId_idx" ON "Order"("prescriptionId");

