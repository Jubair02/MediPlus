/**
 * Round 10 backfill — Prescription.reviewedAt
 * Sets reviewedAt = updatedAt for every APPROVED prescription where reviewedAt is still null
 * (pre-Round-10 approvals were tracked via updatedAt). REJECTED/PENDING rows keep reviewedAt null.
 * Idempotent: re-running finds nothing to do.
 * Run: bun scripts/backfill-rx-reviewedat.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const rows = await prisma.prescription.findMany({
    where: { status: 'APPROVED', reviewedAt: null },
    select: { id: true, updatedAt: true },
    orderBy: { createdAt: 'asc' },
  })
  if (rows.length === 0) {
    console.log('backfill-rx-reviewedat: nothing to do (0 APPROVED prescriptions with null reviewedAt)')
    return
  }
  for (const r of rows) {
    await prisma.prescription.update({ where: { id: r.id }, data: { reviewedAt: r.updatedAt } })
    console.log(`backfilled rx ${r.id} → reviewedAt = ${r.updatedAt.toISOString()}`)
  }
  console.log(`✅ backfill complete — ${rows.length} prescription(s) updated`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
