import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
async function main() {
  const a = await db.category.updateMany({ where: { image: '/images/cat-diabetes.png' }, data: { image: '/images/cat-diabetes-care.png' } })
  const b = await db.category.updateMany({ where: { image: '/images/cat-vitamins.png' }, data: { image: '/images/cat-vitamins-supplements.png' } })
  console.log('updated diabetes:', a.count, 'vitamins:', b.count)
}
main().finally(() => db.$disconnect())
