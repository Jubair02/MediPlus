/**
 * Round 11 demo-data seeder — medicine gallery extras + Q&A edit-window demo question + supplier PO.
 * IDEMPOTENT and NEVER wipes data (same convention as scripts/seed-po-audit.ts /
 * seed-helpful-votes.ts) — safe to re-run anytime, and after any full prisma/seed.ts reset.
 * Run: bun scripts/seed-gallery-qapo.ts
 *
 * - 3 medicines get gallery extras (REUSING existing files in /public/images/), only when the
 *   medicine has NO MedicineImage rows yet: Napa Extra (+ vitaminc, zinconia → 3-image gallery),
 *   Digital BP Monitor (+ glucometer), Amoxin (+ cef3). The primary image stays untouched.
 * - 1 PENDING question by customer@medplus.com on Napa Extra created ~3 minutes ago (inside the
 *   15-minute edit window so the Round 11 edit UI can be demoed live). Guard: skipped when an
 *   identical question text already exists for that user + medicine. createdAt/updatedAt of the
 *   NEW row are set to ~3 minutes ago so the pharmacist `edited` flag stays false until a real edit.
 * - 1 ORDERED purchase order (Crepe Bandage ×40) with supplier 'Square Pharmaceuticals Ltd.' and
 *   expectedAt = today + 5 days (local midnight). Guard: skip when an identical
 *   (medicineId, qty, status, note) row already exists (same guard as the Round 10 PO seeds).
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function minutesAgo(n: number) {
  return new Date(Date.now() - n * 60 * 1000)
}

function localMidnightInDays(n: number) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + n)
  return d
}

async function main() {
  const [pharmacist, customer] = await Promise.all([
    prisma.user.findFirst({ where: { email: 'pharmacist@medplus.com' } }),
    prisma.user.findFirst({ where: { email: 'customer@medplus.com' } }),
  ])
  if (!pharmacist || !customer) throw new Error('demo users not found — run prisma/seed.ts first')

  // ---------- medicine gallery extras (only when the medicine has no MedicineImage rows yet) ----------
  const gallerySeeds = [
    { medName: 'Napa Extra 500mg+65mg', extras: ['/images/med-vitaminc.png', '/images/med-zinconia.png'] },
    { medName: 'Digital BP Monitor', extras: ['/images/med-glucometer.png'] },
    { medName: 'Amoxin 500mg', extras: ['/images/med-cef3.png'] },
  ]
  let galleryCreated = 0
  for (const g of gallerySeeds) {
    const med = await prisma.medicine.findFirst({ where: { name: g.medName } })
    if (!med) {
      console.log(`gallery skipped — medicine "${g.medName}" not found`)
      continue
    }
    const existingCount = await prisma.medicineImage.count({ where: { medicineId: med.id } })
    if (existingCount > 0) {
      console.log(`gallery already seeded (${g.medName} has ${existingCount} extra image rows) — skipping`)
      continue
    }
    await prisma.medicineImage.createMany({
      data: g.extras.map((url, i) => ({ medicineId: med.id, url, sort: i })),
    })
    galleryCreated += g.extras.length
    console.log(`gallery created (${g.medName} + ${g.extras.length} extra image(s))`)
  }

  // ---------- PENDING edit-window demo question (created ~3 minutes ago) ----------
  const napa = await prisma.medicine.findFirst({ where: { name: 'Napa Extra 500mg+65mg' } })
  let questionId: string | null = null
  if (!napa) {
    console.log('question skipped — medicine "Napa Extra 500mg+65mg" not found')
  } else {
    const qText = 'Can I take Napa Extra with my morning coffee?'
    const existingQuestion = await prisma.question.findFirst({
      where: { userId: customer.id, medicineId: napa.id, question: qText },
    })
    if (existingQuestion) {
      questionId = existingQuestion.id
      console.log('question already seeded (identical text for this user + medicine) — skipping')
    } else {
      const createdAt = minutesAgo(3)
      const created = await prisma.question.create({
        data: {
          medicineId: napa.id,
          userId: customer.id,
          question: qText,
          status: 'PENDING',
          createdAt,
          updatedAt: createdAt, // keep the pharmacist `edited` flag false until a real edit happens
        },
      })
      questionId = created.id
      console.log(`question created (${created.id}, createdAt ~3 min ago — inside the 15-min edit window)`)
    }
  }

  // ---------- ORDERED purchase order with supplier + expected delivery date ----------
  const crepe = await prisma.medicine.findFirst({ where: { name: 'Crepe Bandage 4 inch' } })
  let poId: string | null = null
  if (!crepe) {
    console.log('po skipped — medicine "Crepe Bandage 4 inch" not found')
  } else {
    const poSeed = {
      medicineId: crepe.id,
      qty: 40,
      status: 'ORDERED',
      note: 'Weekly restock',
      supplier: 'Square Pharmaceuticals Ltd.',
      expectedAt: localMidnightInDays(5),
    }
    const existingPo = await prisma.purchaseOrder.findFirst({
      where: { medicineId: poSeed.medicineId, qty: poSeed.qty, status: poSeed.status, note: poSeed.note },
    })
    if (existingPo) {
      poId = existingPo.id
      console.log('po already seeded (Crepe Bandage ×40 ORDERED "Weekly restock") — skipping')
    } else {
      const po = await prisma.purchaseOrder.create({
        data: { ...poSeed, orderedById: pharmacist.id },
      })
      poId = po.id
      console.log(`po created (Crepe Bandage ×40 ORDERED, supplier Square Pharmaceuticals Ltd., expectedAt ${poSeed.expectedAt.toISOString()})`)
    }
  }

  const [imageTotal, poTotal] = await Promise.all([prisma.medicineImage.count(), prisma.purchaseOrder.count()])
  console.log(
    `\n✅ seed-gallery-qapo complete — created ${galleryCreated} image row(s) this run (totals: ${imageTotal} MedicineImage rows, ${poTotal} POs)` +
      (questionId ? `\n   demo question id: ${questionId}` : '') +
      (poId ? `\n   supplier demo PO id: ${poId}` : '')
  )
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
