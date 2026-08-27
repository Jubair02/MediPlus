/* Seed demo helpful votes for MediPlus E-Pharmacy Q&A (idempotent — existing votes are skipped).
 * Adds votes from the seeded customer/delivery/pharmacist users onto the seeded ANSWERED
 * questions so the UI shows non-zero helpful counts. Never wipes or duplicates data.
 * Run: bunx tsx scripts/seed-helpful-votes.ts
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

interface SeedVote {
  /** Exact question text of a seeded ANSWERED question. */
  question: string
  askerEmail: string
  voterEmails: string[]
}

const SEED_VOTES: SeedVote[] = [
  {
    question: 'Can I take Napa Extra together with my blood pressure medication?',
    askerEmail: 'customer@medplus.com',
    voterEmails: ['pharmacist@medplus.com', 'delivery@medplus.com'], // 2 votes
  },
  {
    question: 'Should Seclo be taken before meals or after meals?',
    askerEmail: 'rahim@example.com',
    voterEmails: ['customer@medplus.com', 'pharmacist@medplus.com', 'delivery@medplus.com'], // 3 votes
  },
  {
    question: 'Is it okay to dissolve the Vitamin C effervescent tablet in cold water?',
    askerEmail: 'karim@example.com',
    voterEmails: ['customer@medplus.com', 'delivery@medplus.com'], // 2 votes
  },
  {
    question: 'How many hours should I wait between two doses of Napa Extra?',
    askerEmail: 'nusrat@example.com',
    voterEmails: ['pharmacist@medplus.com'], // 1 vote
  },
]

async function main() {
  let created = 0
  let skipped = 0

  for (const seed of SEED_VOTES) {
    const asker = await db.user.findUnique({ where: { email: seed.askerEmail } })
    if (!asker) {
      console.warn(`asker ${seed.askerEmail} not found — skipped`)
      continue
    }
    const question = await db.question.findFirst({
      where: { question: seed.question, userId: asker.id, status: 'ANSWERED' },
      select: { id: true, status: true, question: true },
    })
    if (!question) {
      console.warn(`ANSWERED question "${seed.question.slice(0, 50)}…" by ${seed.askerEmail} not found — skipped`)
      continue
    }
    for (const voterEmail of seed.voterEmails) {
      const voter = await db.user.findUnique({ where: { email: voterEmail } })
      if (!voter) {
        console.warn(`voter ${voterEmail} not found — skipped`)
        continue
      }
      const existing = await db.helpfulVote.findUnique({
        where: { questionId_userId: { questionId: question.id, userId: voter.id } },
        select: { id: true },
      })
      if (existing) {
        skipped++
        continue
      }
      await db.helpfulVote.create({ data: { questionId: question.id, userId: voter.id } })
      created++
    }
  }

  const total = await db.helpfulVote.count()
  console.log(`helpful votes created this run: ${created} (skipped existing: ${skipped}, total in DB: ${total})`)
}

main()
  .then(() => console.log('seed-helpful-votes done'))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
