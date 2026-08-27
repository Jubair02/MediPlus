import { db } from '@/lib/db'
import { serverError } from '@/lib/auth'

/** GET /api/categories (public) → categories with ACTIVE medicine counts, ordered by name */
export async function GET() {
  try {
    const categories = await db.category.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { medicines: { where: { status: 'ACTIVE' } } } } },
    })
    return Response.json({
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        description: c.description,
        image: c.image,
        medicineCount: c._count.medicines,
      })),
    })
  } catch (e) {
    return serverError(e)
  }
}
