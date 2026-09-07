-- CreateEnum
CREATE TYPE "StockRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'ORDERED', 'PARTIALLY_RECEIVED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StockRequestPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "StockRequestItemStatus" AS ENUM ('PENDING', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateTable
CREATE TABLE "StockRequest" (
    "id" TEXT NOT NULL,
    "requestNo" TEXT NOT NULL,
    "status" "StockRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" "StockRequestPriority" NOT NULL DEFAULT 'MEDIUM',
    "reason" TEXT,
    "requestedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "expectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockRequestItem" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "requestedQty" INTEGER NOT NULL,
    "approvedQty" INTEGER,
    "stockAtRequest" INTEGER NOT NULL,
    "status" "StockRequestItemStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockRequest_requestNo_key" ON "StockRequest"("requestNo");

-- CreateIndex
CREATE INDEX "StockRequest_status_createdAt_idx" ON "StockRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "StockRequest_requestedById_idx" ON "StockRequest"("requestedById");

-- CreateIndex
CREATE INDEX "StockRequest_reviewedById_idx" ON "StockRequest"("reviewedById");

-- CreateIndex
CREATE INDEX "StockRequest_priority_status_idx" ON "StockRequest"("priority", "status");

-- CreateIndex
CREATE INDEX "StockRequestItem_medicineId_idx" ON "StockRequestItem"("medicineId");

-- CreateIndex
CREATE INDEX "StockRequestItem_status_idx" ON "StockRequestItem"("status");

-- CreateIndex
CREATE UNIQUE INDEX "StockRequestItem_requestId_medicineId_key" ON "StockRequestItem"("requestId", "medicineId");

-- AddForeignKey
ALTER TABLE "StockRequest" ADD CONSTRAINT "StockRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRequest" ADD CONSTRAINT "StockRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRequestItem" ADD CONSTRAINT "StockRequestItem_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "StockRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRequestItem" ADD CONSTRAINT "StockRequestItem_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "Medicine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

