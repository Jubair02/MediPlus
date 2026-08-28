/**
 * r11c E2E helper — expire / restore / delete a question by id (dev data hygiene only).
 * Usage: bun scripts/r11c-expire-question.ts <id> <expire|restore|delete>
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const [id, action] = process.argv.slice(2)

async function main() {
  if (!id || !action || !['expire', 'restore', 'delete'].includes(action)) {
    throw new Error('Usage: bun scripts/r11c-expire-question.ts <id> <expire|restore|delete>')
  }
  const q = await prisma.question.findUnique({ where: { id } })
  if (!q) throw new Error('Question not found')

  if (action === 'expire') {
    const back = new Date(Date.now() - 20 * 60 * 1000)
    await prisma.question.update({ where: { id }, data: { createdAt: back, updatedAt: back } })
    console.log(`question ${id} createdAt/updatedAt set to ${back.toISOString()} (20 min ago)`)
  } else if (action === 'restore') {
    const fresh = new Date(Date.now() - 60 * 1000)
    await prisma.question.update({ where: { id }, data: { createdAt: fresh, updatedAt: fresh } })
    console.log(`question ${id} createdAt/updatedAt restored to ~1 min ago`)
  } else {
    await prisma.question.delete({ where: { id } })
    console.log(`question ${id} deleted`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
