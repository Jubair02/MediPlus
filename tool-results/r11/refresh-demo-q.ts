import { PrismaClient } from '@prisma/client'

const p = new PrismaClient()

/** One-off demo-window refresh for the Round 11 edit demo question (row originally created by 11-a's seeder). */
async function main() {
  const old = await p.question.findFirst({ where: { question: 'Can I take Napa Extra with my morning coffee?' } })
  if (old) {
    await p.question.delete({ where: { id: old.id } })
    console.log('old demo question deleted (id:', old.id + ')')
  }
  await p.$disconnect()
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => p.$disconnect())
