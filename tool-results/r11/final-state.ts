import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'fs'

const p = new PrismaClient()

async function main() {
  const qid = readFileSync('/tmp/r11expiredqid.txt', 'utf8').trim()
  await p.question.delete({ where: { id: qid } })
  console.log('expired-window probe question deleted:', qid)

  const [imgCount, poGroups, demoQ, medsWithImages, leftover, auditPO] = await Promise.all([
    p.medicineImage.count(),
    p.purchaseOrder.groupBy({ by: ['status'], _count: { _all: true } }),
    p.question.findFirst({ where: { question: 'Can I take Napa Extra with my morning coffee?' }, select: { id: true, status: true, createdAt: true, updatedAt: true } }),
    p.medicine.findMany({ where: { extraImages: { some: {} } }, select: { name: true, _count: { select: { extraImages: true } } } }),
    p.medicine.findMany({ where: { name: { contains: 'R11 ' } }, select: { id: true, name: true, status: true } }),
    p.auditLog.count({ where: { action: 'PO_CREATE' } }),
  ])
  console.log('MedicineImage total:', imgCount)
  console.log('PO counts:', JSON.stringify(poGroups.map((g) => ({ status: g.status, n: g._count._all }))))
  console.log('medicines with extra images:', JSON.stringify(medsWithImages.map((m) => m.name + ': ' + m._count.extraImages)))
  console.log('demo question:', JSON.stringify(demoQ))
  console.log('leftover R11 test medicines:', JSON.stringify(leftover))
  console.log('PO_CREATE audit rows:', auditPO)
  const orders = await p.purchaseOrder.findMany({ where: { status: 'ORDERED' }, select: { id: true, qty: true, note: true, supplier: true, expectedAt: true, medicine: { select: { name: true } } }, orderBy: { orderedAt: 'asc' } })
  console.log('ORDERED POs:', JSON.stringify(orders, null, 1))
  await p.$disconnect()
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => p.$disconnect())
