import { db } from '@/lib/db'
import { requireCustomer, badRequest, notFound, serverError } from '@/lib/auth'
import { readJson, parseAddressInput } from '../_lib'

function shape(a: {
  id: string
  label: string
  recipient: string
  phone: string
  line1: string
  area: string | null
  city: string
  postcode: string | null
  isDefault: boolean
  createdAt: Date
}) {
  return {
    id: a.id,
    label: a.label,
    recipient: a.recipient,
    phone: a.phone,
    line1: a.line1,
    area: a.area,
    city: a.city,
    postcode: a.postcode,
    isDefault: a.isDefault,
    createdAt: a.createdAt,
  }
}

/** GET /api/addresses (Bearer) → my addresses, default first */
export async function GET(request: Request) {
  try {
    const user = await requireCustomer(request)
    if (user instanceof Response) return user
    const addresses = await db.address.findMany({
      where: { userId: user.id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    })
    return Response.json({ addresses: addresses.map(shape) })
  } catch (e) {
    return serverError(e)
  }
}

/** POST /api/addresses {label, recipient, phone, line1, area?, city, postcode?, isDefault?} */
export async function POST(request: Request) {
  try {
    const user = await requireCustomer(request)
    if (user instanceof Response) return user
    const body = await readJson(request)
    if (!body) return badRequest('Invalid request body')
    const parsed = parseAddressInput(body, 'Delivery address required')
    if ('error' in parsed) return badRequest(parsed.error)

    const count = await db.address.count({ where: { userId: user.id } })
    const isDefault = parsed.data.isDefault || count === 0
    const created = await db.address.create({
      data: { ...parsed.data, isDefault, userId: user.id },
    })
    if (isDefault) {
      await db.address.updateMany({ where: { userId: user.id, NOT: { id: created.id } }, data: { isDefault: false } })
    }
    return Response.json({ address: shape(created) }, { status: 201 })
  } catch (e) {
    return serverError(e)
  }
}

/** PUT /api/addresses {id, ...partial} */
export async function PUT(request: Request) {
  try {
    const user = await requireCustomer(request)
    if (user instanceof Response) return user
    const body = await readJson(request)
    if (!body) return badRequest('Invalid request body')
    const id = typeof body.id === 'string' ? body.id : ''
    if (!id) return badRequest('Address id is required')

    const existing = await db.address.findFirst({ where: { id, userId: user.id } })
    if (!existing) return notFound('Address not found')

    const data: { label?: string; recipient?: string; phone?: string; line1?: string; area?: string | null; city?: string; postcode?: string | null } = {}
    const s = (v: unknown) => (typeof v === 'string' ? v.trim() : undefined)
    for (const key of ['label', 'recipient', 'phone', 'line1', 'city'] as const) {
      const v = s(body[key])
      if (v !== undefined) {
        if (v === '') return badRequest(`${key} cannot be empty`)
        data[key] = v
      }
    }
    if (body.area !== undefined) data.area = s(body.area) || null
    if (body.postcode !== undefined) data.postcode = s(body.postcode) || null

    const makeDefault = body.isDefault === true
    const updated = await db.address.update({ where: { id }, data })
    if (makeDefault) {
      await db.address.updateMany({ where: { userId: user.id, NOT: { id } }, data: { isDefault: false } })
      if (!updated.isDefault) {
        const fixed = await db.address.update({ where: { id }, data: { isDefault: true } })
        return Response.json({ address: shape(fixed) })
      }
    }
    return Response.json({ address: shape(updated) })
  } catch (e) {
    return serverError(e)
  }
}

/** DELETE /api/addresses?id= */
export async function DELETE(request: Request) {
  try {
    const user = await requireCustomer(request)
    if (user instanceof Response) return user
    const id = new URL(request.url).searchParams.get('id')
    if (!id) return badRequest('Address id is required')
    const existing = await db.address.findFirst({ where: { id, userId: user.id } })
    if (!existing) return notFound('Address not found')
    await db.address.delete({ where: { id } })
    return Response.json({ ok: true })
  } catch (e) {
    return serverError(e)
  }
}
