import { requireCustomer, badRequest, serverError } from '@/lib/auth'
import { readJson, resolveCoupon } from '../_lib'

/** POST /api/coupons {code, subtotal} → {coupon:{code,type,value,discount,maxDiscount}} */
export async function POST(request: Request) {
  try {
    // Coupon codes are a checkout capability: previously this route was fully anonymous,
    // which let anyone brute-force the coupon table. Customers only.
    const user = await requireCustomer(request)
    if (user instanceof Response) return user
    const body = await readJson(request)
    if (!body) return badRequest('Invalid request body')
    const code = typeof body.code === 'string' ? body.code : ''
    if (!code.trim()) return badRequest('Please enter a coupon code')
    const subtotal = typeof body.subtotal === 'number' && Number.isFinite(body.subtotal) ? body.subtotal : Number(body.subtotal)
    if (!Number.isFinite(subtotal) || subtotal < 0) return badRequest('Invalid subtotal')
    const res = await resolveCoupon(code, subtotal)
    if ('error' in res) return badRequest(res.error)
    return Response.json({ coupon: res.coupon })
  } catch (e) {
    return serverError(e)
  }
}
