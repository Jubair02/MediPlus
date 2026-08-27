import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { notFound, serverError } from '@/lib/auth'
import { numParam } from '../_lib'

function effective(m: { price: number; discountPrice: number | null }): number {
  return m.discountPrice != null ? m.discountPrice : m.price
}

/**
 * GET /api/medicines?id=<id>            → single ACTIVE medicine (include category)
 * GET /api/medicines?search&category&minPrice&maxPrice&rxOnly&sort&featured&page&limit
 */
export async function GET(request: Request) {
  try {
    const sp = new URL(request.url).searchParams
    const id = sp.get('id')
    if (id) {
      const medicine = await db.medicine.findUnique({ where: { id }, include: { category: true } })
      if (!medicine || medicine.status !== 'ACTIVE') return notFound('Medicine not found')
      return Response.json({ medicine })
    }

    const search = sp.get('search')?.trim()
    const categoryParam = sp.get('category')?.trim()
    const minPrice = numParam(sp.get('minPrice'))
    const maxPrice = numParam(sp.get('maxPrice'))
    const rxOnly = sp.get('rxOnly') === 'true'
    const featured = sp.get('featured') === 'true'
    const sort = sp.get('sort') || 'featured'
    const page = Math.max(1, Math.trunc(numParam(sp.get('page')) ?? 1))
    const limit = Math.min(50, Math.max(1, Math.trunc(numParam(sp.get('limit')) ?? 12)))

    const where: Prisma.MedicineWhereInput = { status: 'ACTIVE' }
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { genericName: { contains: search } },
        { brand: { contains: search } },
      ]
    }
    if (featured) where.discountPrice = { not: null }
    if (rxOnly) where.requiresPrescription = true
    if (categoryParam) {
      const cat = await db.category.findFirst({ where: { OR: [{ id: categoryParam }, { slug: categoryParam }] } })
      // Unknown category slug/id → no results
      where.categoryId = cat ? cat.id : '__none__'
    }
    if (minPrice !== undefined || maxPrice !== undefined) {
      const priceRange: Prisma.FloatFilter = {}
      const discountRange: Prisma.FloatNullableFilter = {}
      if (minPrice !== undefined) {
        priceRange.gte = minPrice
        discountRange.gte = minPrice
      }
      if (maxPrice !== undefined) {
        priceRange.lte = maxPrice
        discountRange.lte = maxPrice
      }
      where.AND = [{ OR: [{ price: priceRange }, { discountPrice: discountRange }] }]
    }

    const all = await db.medicine.findMany({ where, include: { category: true } })

    switch (sort) {
      case 'price-asc':
        all.sort((a, b) => effective(a) - effective(b))
        break
      case 'price-desc':
        all.sort((a, b) => effective(b) - effective(a))
        break
      case 'name-asc':
        all.sort((a, b) => a.name.localeCompare(b.name))
        break
      case 'name-desc':
        all.sort((a, b) => b.name.localeCompare(a.name))
        break
      case 'newest':
        all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        break
      default:
        // 'featured': discounted first, then newest
        all.sort((a, b) => {
          const ad = a.discountPrice != null ? 0 : 1
          const bd = b.discountPrice != null ? 0 : 1
          if (ad !== bd) return ad - bd
          return b.createdAt.getTime() - a.createdAt.getTime()
        })
    }

    const usePage = featured ? 1 : page
    const useLimit = featured ? 8 : limit
    const total = all.length
    const pages = Math.ceil(total / useLimit)
    const medicines = all.slice((usePage - 1) * useLimit, usePage * useLimit)
    return Response.json({ medicines, total, page: usePage, pages })
  } catch (e) {
    return serverError(e)
  }
}
