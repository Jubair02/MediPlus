/**
 * Round 10 demo-data seeder — PurchaseOrders + AuditLog samples (+ rx-expiry demo backdate).
 * IDEMPOTENT and NEVER wipes data (same convention as scripts/seed-questions.ts /
 * seed-helpful-votes.ts) — safe to re-run anytime, and after any full prisma/seed.ts reset.
 * Run: bun scripts/seed-po-audit.ts
 *
 * - 3 purchase orders on the seeded low-stock medicines: 1 RECEIVED (with receivedAt +
 *   receivedBy = pharmacist), 2 ORDERED with supplier notes. A PO is skipped when an
 *   identical (medicineId, qty, status, note) row already exists.
 * - 3 sample audit rows (RX_REVIEW / PAYMENT_STATUS / PO_RECEIVE). A row is skipped when an
 *   identical (action, entityRef, detail) entry already exists.
 * - Backdates the round-1 approved prescription's reviewedAt to ~85 days ago so the
 *   90-day approval-expiry demo fires (expires in ~5 days → reminder notification).
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function daysAgo(n: number) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000)
}

async function main() {
  const pharmacist = await prisma.user.findFirst({ where: { email: 'pharmacist@medplus.com' } })
  if (!pharmacist) throw new Error('pharmacist@medplus.com not found — run prisma/seed.ts first')

  // ---------- purchase orders (low-stock demo medicines) ----------
  const poSeeds = [
    { medName: 'Amoxin 500mg', qty: 100, status: 'RECEIVED', note: 'Supplier: Square Pharma', orderedAt: daysAgo(7), receivedAt: daysAgo(5) },
    { medName: 'Crepe Bandage 4 inch', qty: 60, status: 'ORDERED', note: 'Supplier: Square Pharma', orderedAt: daysAgo(2), receivedAt: null as Date | null },
    { medName: 'Digital BP Monitor', qty: 10, status: 'ORDERED', note: 'Supplier: Roche Distributor', orderedAt: daysAgo(1), receivedAt: null as Date | null },
  ]
  let poCreated = 0
  let receivedPoId: string | null = null
  for (const s of poSeeds) {
    const med = await prisma.medicine.findFirst({ where: { name: s.medName, status: 'ACTIVE' } })
    if (!med) {
      console.log(`po skipped — medicine "${s.medName}" not found`)
      continue
    }
    const existing = await prisma.purchaseOrder.findFirst({ where: { medicineId: med.id, qty: s.qty, status: s.status, note: s.note } })
    if (existing) {
      if (s.status === 'RECEIVED') receivedPoId = existing.id
      console.log(`po already seeded (${s.medName} ×${s.qty} ${s.status}) — skipping`)
      continue
    }
    const po = await prisma.purchaseOrder.create({
      data: {
        medicineId: med.id,
        qty: s.qty,
        status: s.status,
        note: s.note,
        orderedById: pharmacist.id,
        receivedById: s.status === 'RECEIVED' ? pharmacist.id : null,
        orderedAt: s.orderedAt,
        receivedAt: s.receivedAt,
      },
    })
    if (s.status === 'RECEIVED') receivedPoId = po.id
    poCreated++
    console.log(`po created (${s.medName} ×${s.qty} ${s.status})`)
  }

  // ---------- sample audit log rows ----------
  const auditSeeds: Array<{ actorId: string; actorName: string; actorEmail: string; actorRole: string; action: string; entityType: string; entityRef: string; detail: string; createdAt: Date }> = []
  const demoRx = await prisma.prescription.findFirst({
    where: { status: 'APPROVED', reviewNote: 'Valid prescription, medicines verified.' },
    orderBy: { createdAt: 'asc' },
  })
  const admin = await prisma.user.findFirst({ where: { email: 'admin@medplus.com' } })
  if (demoRx) {
    auditSeeds.push({ actorId: pharmacist.id, actorName: pharmacist.name ?? 'Pharmacist', actorEmail: pharmacist.email, actorRole: pharmacist.role, action: 'RX_REVIEW', entityType: 'PRESCRIPTION', entityRef: demoRx.id, detail: 'Approved prescription for customer@medplus.com', createdAt: daysAgo(6) })
  }
  const o1 = await prisma.order.findUnique({ where: { orderNo: 'MP-100001' } })
  if (o1 && admin) {
    auditSeeds.push({ actorId: admin.id, actorName: admin.name ?? 'Admin', actorEmail: admin.email, actorRole: admin.role, action: 'PAYMENT_STATUS', entityType: 'PAYMENT', entityRef: 'MP-100001', detail: 'Payment status set to PAID', createdAt: daysAgo(4) })
  }
  if (receivedPoId) {
    auditSeeds.push({ actorId: pharmacist.id, actorName: pharmacist.name ?? 'Pharmacist', actorEmail: pharmacist.email, actorRole: pharmacist.role, action: 'PO_RECEIVE', entityType: 'PURCHASE_ORDER', entityRef: receivedPoId, detail: 'Received 100 × Amoxin 500mg', createdAt: daysAgo(5) })
  }
  let auditCreated = 0
  for (const a of auditSeeds) {
    const existing = await prisma.auditLog.findFirst({ where: { action: a.action, entityRef: a.entityRef, detail: a.detail } })
    if (existing) {
      console.log(`audit already seeded (${a.action} ${a.entityRef}) — skipping`)
      continue
    }
    await prisma.auditLog.create({ data: a })
    auditCreated++
    console.log(`audit created (${a.action} ${a.entityRef})`)
  }

  // ---------- rx-expiry demo backdate (round-1 approved prescription → ~5 days left) ----------
  if (demoRx) {
    const reviewedAt = daysAgo(85)
    await prisma.prescription.update({ where: { id: demoRx.id }, data: { reviewedAt } })
    console.log(`expiry demo — rx ${demoRx.id} reviewedAt → ${reviewedAt.toISOString()} (expires in ~5 days)`)
  }

  const [poTotal, auditTotal] = await Promise.all([prisma.purchaseOrder.count(), prisma.auditLog.count()])
  console.log(`\n✅ seed-po-audit complete — created ${poCreated} PO(s) / ${auditCreated} audit row(s) this run (totals: ${poTotal} POs, ${auditTotal} audit rows)`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
