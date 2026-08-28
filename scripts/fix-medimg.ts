import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
async function main() {
  const m = await db.medicine.updateMany({ where: { name: { contains: 'Vitamin C 500mg' } }, data: { image: '/images/med-vitaminc.png' } })
  console.log('updated medicines:', m.count)
}
main().finally(() => db.$disconnect())
