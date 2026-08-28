/* Seed demo reviews + stock movements for MediPlus E-Pharmacy (idempotent — safe to re-run).
 * Run: bun run scripts/seed-reviews.ts
 */
import { PrismaClient } from '@prisma/client'
import { randomBytes, scryptSync } from 'crypto'

const db = new PrismaClient()

// ---------- crypto helper (mirror of src/lib/auth.ts — same scrypt salt:hash format) ----------
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000)
}

interface SeedReview {
  email: string
  part: string // medicine name fragment to look up
  rating: number
  comment: string
  days: number
}

async function main() {
  // ---------- demo customers (created only when missing) ----------
  const demoCustomers = [
    { name: 'Karim Rahman', email: 'karim@example.com' },
    { name: 'Salma Akter', email: 'salma@example.com' },
    { name: 'Rahim Mia', email: 'rahim@example.com' },
  ]
  for (const c of demoCustomers) {
    const existing = await db.user.findUnique({ where: { email: c.email } })
    if (!existing) {
      await db.user.create({
        data: { name: c.name, email: c.email, role: 'CUSTOMER', status: 'ACTIVE', password: hashPassword('Customer123!') },
      })
      console.log(`created customer ${c.email}`)
    }
  }

  const users = await db.user.findMany({
    where: { email: { in: ['customer@medplus.com', 'rahim@example.com', 'karim@example.com', 'salma@example.com'] } },
  })
  const userByEmail = new Map(users.map((u) => [u.email, u]))

  // ---------- ~14 realistic reviews across 8 popular ACTIVE medicines ----------
  const reviews: SeedReview[] = [
    { email: 'customer@medplus.com', part: 'Napa', rating: 5, comment: 'Genuine product, fast delivery to Dhanmondi.', days: 3 },
    { email: 'customer@medplus.com', part: 'Neuro', rating: 5, comment: 'Effective for nerve pain, would buy again.', days: 6 },
    { email: 'customer@medplus.com', part: 'Maxpro', rating: 4, comment: 'Works well, packaging was sealed.', days: 9 },
    { email: 'customer@medplus.com', part: 'Digital BP', rating: 5, comment: 'Accurate readings, my father uses it every morning.', days: 12 },
    { email: 'rahim@example.com', part: 'Napa', rating: 4, comment: 'Works well for fever, delivery took only one day.', days: 2 },
    { email: 'rahim@example.com', part: 'Seclo', rating: 5, comment: 'Best price in town, genuine product.', days: 5 },
    { email: 'rahim@example.com', part: 'Fexo', rating: 4, comment: 'Relief from allergy within an hour.', days: 8 },
    { email: 'karim@example.com', part: 'Vitamin C 500mg', rating: 5, comment: 'Genuine product, fast delivery to Uttara.', days: 1 },
    { email: 'karim@example.com', part: 'Seclo', rating: 4, comment: 'Good for gastric problems, strip was sealed.', days: 4 },
    { email: 'karim@example.com', part: 'Glucometer', rating: 3, comment: 'Slightly expensive but authentic.', days: 7 },
    { email: 'karim@example.com', part: 'Maxpro', rating: 4, comment: 'Effective for my vitamin D deficiency.', days: 10 },
    { email: 'salma@example.com', part: 'Napa', rating: 5, comment: 'Effective for fever, would buy again.', days: 2 },
    { email: 'salma@example.com', part: 'Fexo', rating: 4, comment: 'Good quality, strips arrived in perfect condition.', days: 6 },
    { email: 'salma@example.com', part: 'Vitamin C 500mg', rating: 3, comment: 'Slightly expensive but authentic.', days: 11 },
  ]

  let reviewsCreated = 0
  for (const r of reviews) {
    const user = userByEmail.get(r.email)
    if (!user) continue
    const med = await db.medicine.findFirst({
      where: { name: { contains: r.part }, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    })
    if (!med) continue
    await db.review.upsert({
      where: { userId_medicineId: { userId: user.id, medicineId: med.id } },
      update: {}, // already seeded — keep existing rating/createdAt (idempotent re-runs)
      create: { userId: user.id, medicineId: med.id, rating: r.rating, comment: r.comment, createdAt: daysAgo(r.days), updatedAt: daysAgo(r.days) },
    })
    reviewsCreated++
  }

  // ---------- ~10 SEED stock movements staggered over past days ----------
  const seedMovements: { part: string; delta: number; days: number }[] = [
    { part: 'Napa', delta: 500, days: 12 },
    { part: 'Vitamin C 500mg', delta: 200, days: 11 },
    { part: 'Maxpro', delta: 150, days: 10 },
    { part: 'Fexo', delta: 180, days: 9 },
    { part: 'Seclo', delta: 220, days: 8 },
    { part: 'Neuro', delta: 160, days: 7 },
    { part: 'Digital BP', delta: 40, days: 6 },
    { part: 'Glucometer', delta: 60, days: 6 },
    { part: 'Ace 500mg', delta: 300, days: 5 },
    { part: 'Torex', delta: 120, days: 4 },
  ]

  let movementsCreated = 0
  for (const m of seedMovements) {
    const med = await db.medicine.findFirst({
      where: { name: { contains: m.part }, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    })
    if (!med) continue
    const existing = await db.stockMovement.findFirst({ where: { medicineId: med.id, reason: 'SEED' } })
    if (existing) continue // one SEED row per medicine (idempotent)
    await db.stockMovement.create({
      data: { medicineId: med.id, delta: m.delta, reason: 'SEED', note: 'Initial inventory', createdAt: daysAgo(m.days) },
    })
    movementsCreated++
  }

  const totalReviews = await db.review.count()
  const totalMovements = await db.stockMovement.count()
  const totalCustomers = await db.user.count({ where: { role: 'CUSTOMER' } })
  console.log(`reviews created this run: ${reviewsCreated} (total in DB: ${totalReviews})`)
  console.log(`stock movements created this run: ${movementsCreated} (total in DB: ${totalMovements})`)
  console.log(`customer users: ${totalCustomers}`)
}

main()
  .then(() => console.log('seed-reviews done'))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
