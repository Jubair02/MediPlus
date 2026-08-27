import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getAuthUser, unauthorized, badRequest, notFound, serverError } from '@/lib/auth'
import {
  readJson,
  orderInclude,
  parseOrder,
  addressToJson,
  parseAddressInput,
  resolveCoupon,
  type ParsedAddress,
} from '../_lib'

const CANCELLABLE = ['PENDING', 'PRESCRIPTION_REVIEW', 'CONFIRMED', 'PROCESSING']
const RESTOCK_STATUSES = ['CONFIRMED', 'PROCESSING', 'OUT_FOR_DELIVERY']
const FREE_DELIVERY_MIN = 2000
const DELIVERY_FEE = 60

async function loadCart(userId: string) {
  return db.cartItem.findMany({ where: { userId }, include: { medicine: true }, orderBy: { createdAt: 'asc' } })
}

async function loadFullOrder(id: string) {
  return db.order.findUnique({ where: { id }, include: orderInclude })
}

/**
 * POST /api/orders — place an order from the current cart.
 * Body: {addressId? | address?, prescriptionId?, prescription?{image,note?}, couponCode?, paymentMethod:'COD'|'BKASH_DEMO'}
 */
export async function POST(request: Request) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const body = await readJson(request)
    if (!body) return badRequest('Invalid request body')

    const cartItems = await loadCart(user.id)
    if (cartItems.length === 0) return badRequest('Your cart is empty')

    // 1. Validate medicines & stock BEFORE creating anything
    for (const it of cartItems) {
      if (it.medicine.status !== 'ACTIVE') return badRequest(`${it.medicine.name} is no longer available`)
      if (it.quantity > it.medicine.stock) return badRequest(`Insufficient stock for ${it.medicine.name}`)
    }

    // 2. Resolve delivery address (creation of a NEW address happens inside the order transaction)
    let savedAddress: { id: string; label: string; recipient: string; phone: string; line1: string; area: string | null; city: string; postcode: string | null; isDefault: boolean } | null = null
    let newAddress: { label: string; recipient: string; phone: string; line1: string; area: string | null; city: string; postcode: string | null; isDefault: boolean } | null = null
    if (typeof body.addressId === 'string' && body.addressId) {
      const saved = await db.address.findFirst({ where: { id: body.addressId, userId: user.id } })
      if (!saved) return notFound('Address not found')
      savedAddress = {
        id: saved.id,
        label: saved.label,
        recipient: saved.recipient,
        phone: saved.phone,
        line1: saved.line1,
        area: saved.area,
        city: saved.city,
        postcode: saved.postcode,
        isDefault: saved.isDefault,
      }
    } else if (body.address !== undefined && body.address !== null) {
      const parsed = parseAddressInput(body.address)
      if ('error' in parsed) return badRequest(parsed.error)
      newAddress = parsed.data
    } else {
      return badRequest('Delivery address required')
    }

    // 3. Payment method
    let paymentMethod = 'COD'
    if (body.paymentMethod !== undefined) {
      if (body.paymentMethod === 'COD' || body.paymentMethod === 'BKASH_DEMO') paymentMethod = body.paymentMethod
      else return badRequest('Invalid payment method')
    }

    // 4. Totals
    const subtotal = cartItems.reduce((sum, it) => sum + (it.medicine.discountPrice ?? it.medicine.price) * it.quantity, 0)
    const deliveryFee = subtotal >= FREE_DELIVERY_MIN ? 0 : DELIVERY_FEE

    let discount = 0
    let couponCode: string | null = null
    if (typeof body.couponCode === 'string' && body.couponCode.trim() !== '') {
      const res = await resolveCoupon(body.couponCode, subtotal)
      if ('error' in res) return badRequest(res.error)
      discount = res.coupon.discount
      couponCode = res.coupon.code
    }
    const total = subtotal - discount + deliveryFee

    // 5. Prescription rules
    const needsRx = cartItems.some((it) => it.medicine.requiresPrescription)
    let status = 'CONFIRMED'
    let paymentStatus = paymentMethod === 'BKASH_DEMO' ? 'PAID' : 'PENDING'
    let prescriptionId: string | null = null
    let newRxImage: string | null = null
    let newRxNote: string | null = null
    let deductStock = true

    if (needsRx) {
      if (typeof body.prescriptionId === 'string' && body.prescriptionId) {
        const rx = await db.prescription.findFirst({ where: { id: body.prescriptionId, userId: user.id } })
        if (!rx) return notFound('Prescription not found')
        if (rx.status !== 'APPROVED') return badRequest('Prescription is not approved yet')
        prescriptionId = rx.id
      } else if (typeof body.prescription === 'object' && body.prescription !== null) {
        const p = body.prescription as Record<string, unknown>
        const image = typeof p.image === 'string' ? p.image : ''
        if (!image.startsWith('data:image')) return badRequest('Please upload a valid image')
        newRxImage = image
        newRxNote = typeof p.note === 'string' && p.note.trim() !== '' ? p.note.trim() : null
        status = 'PRESCRIPTION_REVIEW'
        paymentStatus = 'PENDING'
        deductStock = false
      } else {
        return badRequest('Prescription required for prescription items')
      }
    }

    // 6. Create order (retry orderNo on unique conflict)
    const baseNo = 100000 + (await db.order.count()) + 1
    let created: { id: string } | null = null
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        created = await db.$transaction(async (tx) => {
          let address: ParsedAddress
          if (savedAddress) {
            address = savedAddress
          } else {
            const base = newAddress as ParsedAddress
            const count = await tx.address.count({ where: { userId: user.id } })
            const isDefault = base.isDefault || count === 0
            const createdAddr = await tx.address.create({ data: { ...base, isDefault, userId: user.id } })
            if (isDefault) {
              await tx.address.updateMany({ where: { userId: user.id, NOT: { id: createdAddr.id } }, data: { isDefault: false } })
            }
            address = { ...base, isDefault, id: createdAddr.id }
          }
          let rxId = prescriptionId
          if (newRxImage) {
            const rx = await tx.prescription.create({ data: { userId: user.id, image: newRxImage, note: newRxNote } })
            rxId = rx.id
          }
          const order = await tx.order.create({
            data: {
              orderNo: `MP-${baseNo + attempt}`,
              userId: user.id,
              addressJson: addressToJson(address),
              subtotal,
              discount,
              deliveryFee,
              total,
              couponCode,
              paymentMethod,
              paymentStatus,
              status,
              prescriptionId: rxId,
              items: {
                create: cartItems.map((it) => ({
                  medicineId: it.medicineId,
                  name: it.medicine.name,
                  price: it.medicine.discountPrice ?? it.medicine.price,
                  quantity: it.quantity,
                  image: it.medicine.image,
                  requiresPrescription: it.medicine.requiresPrescription,
                })),
              },
              payment: {
                create: {
                  method: paymentMethod,
                  status: paymentStatus === 'PAID' ? 'PAID' : 'PENDING',
                  amount: total,
                  ...(paymentMethod === 'BKASH_DEMO' && paymentStatus === 'PAID'
                    ? { transactionId: `BKASH-DEMO-${Date.now()}` }
                    : {}),
                },
              },
            },
            include: orderInclude,
          })
          if (deductStock) {
            for (const it of cartItems) {
              await tx.medicine.update({ where: { id: it.medicineId }, data: { stock: { decrement: it.quantity } } })
            }
          }
          await tx.cartItem.deleteMany({ where: { userId: user.id } })
          await tx.notification.create({
            data: { userId: user.id, title: 'Order placed', message: `Order ${order.orderNo} has been placed successfully.` },
          })
          return order
        })
        break
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && attempt < 4) continue
        return serverError(e)
      }
    }
    if (!created) return serverError(new Error('Could not create order'))

    const full = await loadFullOrder(created.id)
    if (!full) return serverError(new Error('Order not found after creation'))
    return Response.json({ order: parseOrder(full, { prescriptionImage: false }) }, { status: 201 })
  } catch (e) {
    return serverError(e)
  }
}

/** GET /api/orders → my orders (newest first); GET /api/orders?id= → single (ownership, prescription with image) */
export async function GET(request: Request) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const id = new URL(request.url).searchParams.get('id')
    if (id) {
      const order = await db.order.findFirst({ where: { id, userId: user.id }, include: orderInclude })
      if (!order) return notFound('Order not found')
      return Response.json({ order: parseOrder(order, { prescriptionImage: true }) })
    }
    const orders = await db.order.findMany({
      where: { userId: user.id },
      include: orderInclude,
      orderBy: { createdAt: 'desc' },
    })
    return Response.json({ orders: orders.map((o) => parseOrder(o)) })
  } catch (e) {
    return serverError(e)
  }
}

/** PUT /api/orders {action:'cancel'|'reorder', id} */
export async function PUT(request: Request) {
  try {
    const user = await getAuthUser(request)
    if (!user) return unauthorized()
    const body = await readJson(request)
    if (!body) return badRequest('Invalid request body')
    const action = typeof body.action === 'string' ? body.action : ''
    const id = typeof body.id === 'string' ? body.id : ''
    if (!id) return badRequest('Order id is required')

    if (action === 'cancel') {
      const order = await db.order.findFirst({ where: { id, userId: user.id }, include: { ...orderInclude, items: { include: { medicine: true } } } })
      if (!order) return notFound('Order not found')
      if (!CANCELLABLE.includes(order.status)) return badRequest('Order cannot be cancelled now')

      const restock = RESTOCK_STATUSES.includes(order.status)
      const wasPaid = order.paymentStatus === 'PAID'
      await db.$transaction(async (tx) => {
        if (restock) {
          for (const it of order.items) {
            if (it.medicineId) {
              await tx.medicine.update({ where: { id: it.medicineId }, data: { stock: { increment: it.quantity } } })
            }
          }
        }
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'CANCELLED', statusNote: 'Cancelled by customer', ...(wasPaid ? { paymentStatus: 'REFUNDED' } : {}) },
        })
        if (wasPaid && order.payment) {
          await tx.payment.update({ where: { id: order.payment.id }, data: { status: 'REFUNDED' } })
        }
        await tx.notification.create({
          data: { userId: user.id, title: 'Order cancelled', message: `Order ${order.orderNo} has been cancelled.` },
        })
      })
      const full = await loadFullOrder(order.id)
      if (!full) return notFound('Order not found')
      return Response.json({ order: parseOrder(full) })
    }

    if (action === 'reorder') {
      const order = await db.order.findFirst({ where: { id, userId: user.id }, include: { items: true } })
      if (!order) return notFound('Order not found')
      for (const item of order.items) {
        if (!item.medicineId) continue
        const medicine = await db.medicine.findUnique({ where: { id: item.medicineId } })
        if (!medicine || medicine.status !== 'ACTIVE' || medicine.stock <= 0) continue
        const quantity = Math.min(item.quantity, medicine.stock)
        await db.cartItem.upsert({
          where: { userId_medicineId: { userId: user.id, medicineId: medicine.id } },
          update: { quantity },
          create: { userId: user.id, medicineId: medicine.id, quantity },
        })
      }
      const items = await db.cartItem.findMany({
        where: { userId: user.id },
        include: { medicine: { include: { category: true } } },
        orderBy: { createdAt: 'desc' },
      })
      return Response.json({ items })
    }

    return badRequest('Invalid action')
  } catch (e) {
    return serverError(e)
  }
}
