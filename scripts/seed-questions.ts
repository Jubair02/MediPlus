/* Seed demo Q&A questions for MediPlus E-Pharmacy (idempotent — skips when Question count > 0).
 * Run: bunx tsx scripts/seed-questions.ts
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000)
}

interface SeedQuestion {
  medicinePart: string
  askerEmail: string
  question: string
  answer?: string
  createdDaysAgo: number
  answeredHoursAfter?: number
}

const SEED_QUESTIONS: SeedQuestion[] = [
  {
    medicinePart: 'Napa Extra',
    askerEmail: 'customer@medplus.com',
    question: 'Can I take Napa Extra together with my blood pressure medication?',
    answer:
      'Napa Extra (paracetamol + caffeine) has no known direct interaction with most blood pressure medicines. However, please consult your physician before combining them regularly, especially if you have hypertension.',
    createdDaysAgo: 9,
    answeredHoursAfter: 5,
  },
  {
    medicinePart: 'Seclo',
    askerEmail: 'rahim@example.com',
    question: 'Should Seclo be taken before meals or after meals?',
    answer:
      'Seclo (omeprazole) works best when taken 30–60 minutes before breakfast, once daily. Swallow the capsule whole — do not chew or crush it.',
    createdDaysAgo: 7,
    answeredHoursAfter: 3,
  },
  {
    medicinePart: 'Vitamin C',
    askerEmail: 'karim@example.com',
    question: 'Is it okay to dissolve the Vitamin C effervescent tablet in cold water?',
    answer:
      'Yes. Dissolve one tablet in a glass of water (cold or room temperature) and drink immediately. Avoid hot water as heat may degrade the vitamin. The usual dose is one tablet daily.',
    createdDaysAgo: 5,
    answeredHoursAfter: 8,
  },
  {
    medicinePart: 'Napa Extra',
    askerEmail: 'nusrat@example.com',
    question: 'How many hours should I wait between two doses of Napa Extra?',
    createdDaysAgo: 2,
  },
  {
    medicinePart: 'Seclo',
    askerEmail: 'customer@medplus.com',
    question: 'I missed a dose of Seclo this morning — should I take a double dose later?',
    createdDaysAgo: 1,
  },
]

async function main() {
  const existing = await db.question.count()
  if (existing > 0) {
    console.log(`questions already seeded (${existing} in DB) — skipping`)
    return
  }

  const pharmacist = await db.user.findUnique({ where: { email: 'pharmacist@medplus.com' } })
  if (!pharmacist) throw new Error('pharmacist@medplus.com not found — run the main seed first')

  let created = 0
  for (const q of SEED_QUESTIONS) {
    const med = await db.medicine.findFirst({
      where: { name: { contains: q.medicinePart }, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    })
    if (!med) {
      console.warn(`medicine "${q.medicinePart}" not found — skipped`)
      continue
    }
    const asker = await db.user.findUnique({ where: { email: q.askerEmail } })
    if (!asker) {
      console.warn(`user ${q.askerEmail} not found — skipped`)
      continue
    }
    const createdAt = daysAgo(q.createdDaysAgo)
    const answeredAt = q.answer ? new Date(createdAt.getTime() + (q.answeredHoursAfter ?? 4) * 60 * 60 * 1000) : null
    await db.question.create({
      data: {
        medicineId: med.id,
        userId: asker.id,
        question: q.question,
        answer: q.answer ?? null,
        answeredById: q.answer ? pharmacist.id : null,
        answeredAt,
        status: q.answer ? 'ANSWERED' : 'PENDING',
        createdAt,
        updatedAt: answeredAt ?? createdAt,
      },
    })
    created++
  }

  const total = await db.question.count()
  console.log(`questions created this run: ${created} (total in DB: ${total})`)
}

main()
  .then(() => console.log('seed-questions done'))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
