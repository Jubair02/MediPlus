import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getAuthUser, notFound, serverError } from '@/lib/auth'
import { numParam } from '../_lib'

function effective(m: { price: number; discountPrice: number | null }): number {
  return m.discountPrice != null ? m.discountPrice : m.price
}

/** Average rating + review count per medicine id (Prisma relation include supports only _count, so aggregate via groupBy). */
async function ratingsFor(medicineIds: string[]): Promise<Map<string, { rating: number | null; ratingCount: number }>> {
  if (medicineIds.length === 0) return new Map()
  const grouped = await db.review.groupBy({
    by: ['medicineId'],
    where: { medicineId: { in: medicineIds } },
    _avg: { rating: true },
    _count: { _all: true },
  })
  const map = new Map<string, { rating: number | null; ratingCount: number }>()
  for (const g of grouped) {
    map.set(g.medicineId, {
      rating: g._avg.rating == null ? null : Math.round(g._avg.rating * 10) / 10,
      ratingCount: g._count._all,
    })
  }
  return map
}

function withRatings<T extends { id: string }>(medicine: T, ratings: Map<string, { rating: number | null; ratingCount: number }>) {
  const r = ratings.get(medicine.id)
  return { ...medicine, rating: r?.rating ?? null, ratingCount: r?.ratingCount ?? 0 }
}

/**
 * GET /api/medicines?id=<id>            → single ACTIVE medicine (include category)
 * GET /api/medicines?recommended=true&limit=4 → personalized picks from order history (auth) with top-rated fallback
 * GET /api/medicines?search&category&minPrice&maxPrice&rxOnly&sort&featured&page&limit
 */
export async function GET(request: Request) {
  try {
    const sp = new URL(request.url).searchParams
    const id = sp.get('id')
    if (id) {
      const medicine = await db.medicine.findUnique({ where: { id }, include: { category: true } })
      if (!medicine || medicine.status !== 'ACTIVE') return notFound('Medicine not found')
      const ratings = await ratingsFor([medicine.id])
      return Response.json({ medicine: withRatings(medicine, ratings) })
    }

    // ---- recommended for you: history-driven picks, top-rated fallback ----
    if (sp.get('recommended') === 'true') {
      const take = Math.min(8, Math.max(1, Math.trunc(numParam(sp.get('limit')) ?? 4)))
      const user = await getAuthUser(request)

      let picks: Prisma.MedicineGetPayload<{ include: { category: true } }>[] = []
      if (user) {
        const orders = await db.order.findMany({
          where: { userId: user.id, status: { not: 'CANCELLED' } },
          select: { items: { select: { medicineId: true } } },
        })
        const orderedIds = [...new Set(orders.flatMap((o) => o.items.map((it) => it.medicineId).filter((x): x is string => !!x)))]
        if (orderedIds.length > 0) {
          const orderedMeds = await db.medicine.findMany({ where: { id: { in: orderedIds } }, select: { categoryId: true } })
          const categoryIds = [...new Set(orderedMeds.map((m) => m.categoryId).filter((x): x is string => !!x))]
          if (categoryIds.length > 0) {
            picks = await db.medicine.findMany({
              where: { status: 'ACTIVE', categoryId: { in: categoryIds }, id: { notIn: orderedIds } },
              include: { category: true },
              orderBy: { createdAt: 'desc' },
              take,
            })
          }
        }
      }

      if (picks.length === 0) {
        // fallback (guest / no history / no matches): top-rated actives — same scoring as ?sort=rating
        picks = await db.medicine.findMany({ where: { status: 'ACTIVE' }, include: { category: true } })
        const groups = await db.review.groupBy({
          by: ['medicineId'],
          _avg: { rating: true },
          _count: { _all: true },
        })
        const score = new Map(
          groups.map((g) => {
            const avg = g._avg.rating ?? 0
            const count = g._count._all
            return [g.medicineId, avg > 0 ? avg + Math.min(1, count / 10) : -1] as const
          })
        )
        picks.sort((a, b) => (score.get(b.id) ?? -1) - (score.get(a.id) ?? -1))
        picks = picks.slice(0, take)
      }

      const ratings = await ratingsFor(picks.map((m) => m.id))
      return Response.json({ medicines: picks.map((m) => withRatings(m, ratings)) })
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
      case 'rating': {
        const groups = await db.review.groupBy({
          by: ['medicineId'],
          _avg: { rating: true },
          _count: { _all: true },
        })
        const score = new Map(
          groups.map((g) => {
            const avg = g._avg.rating ?? 0
            const count = g._count._all
            // rated first; score = avg + small count bonus (max +1), unrated sink
            return [g.medicineId, avg > 0 ? avg + Math.min(1, count / 10) : -1] as const
          })
        )
        all.sort((a, b) => (score.get(b.id) ?? -1) - (score.get(a.id) ?? -1))
        break
      }
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
    const ratings = await ratingsFor(medicines.map((m) => m.id))
    return Response.json({ medicines: medicines.map((m) => withRatings(m, ratings)), total, page: usePage, pages })
  } catch (e) {
    return serverError(e)
  }
}
