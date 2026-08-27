/* Demo-data polish (Task 6-a): replace the ugly solid black/green test placeholder images
 * on the prescriptions linked to E2E-test orders MP-100009 / MP-100010 with a generated
 * realistic prescription photo at /images/rx-sample.png.
 *
 * Idempotent — safe to re-run (skips prescriptions already pointing at the new image).
 * Only touches the two prescriptions linked to those exact orderNos; seeded/real
 * prescriptions (SVG/JPEG data URLs that render fine) are left untouched.
 *
 * Run: bun run scripts/fix-rx-images.ts
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const NEW_IMAGE = '/images/rx-sample.png'
const ORDER_NOS = ['MP-100009', 'MP-100010']

async function main() {
  const orders = await db.order.findMany({
    where: { orderNo: { in: ORDER_NOS } },
    select: { orderNo: true, prescriptionId: true },
  })

  let updated = 0
  for (const order of orders) {
    if (!order.prescriptionId) {
      console.log(`${order.orderNo}: no linked prescription — skipped`)
      continue
    }
    const rx = await db.prescription.findUnique({ where: { id: order.prescriptionId } })
    if (!rx) {
      console.log(`${order.orderNo}: prescription ${order.prescriptionId} not found — skipped`)
      continue
    }
    if (rx.image === NEW_IMAGE) {
      console.log(`${order.orderNo}: prescription ${rx.id} already points to ${NEW_IMAGE} — nothing to do`)
      continue
    }
    await db.prescription.update({ where: { id: rx.id }, data: { image: NEW_IMAGE } })
    updated++
    console.log(`${order.orderNo}: prescription ${rx.id} image updated → ${NEW_IMAGE}`)
  }
  console.log(`prescriptions updated this run: ${updated}`)
}

main()
  .then(() => console.log('fix-rx-images done'))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
