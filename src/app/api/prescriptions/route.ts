import { db } from '@/lib/db'
import { requireCustomer, badRequest, serverError } from '@/lib/auth'
import { readJson, parseImageInput, rxExpiryFields, RX_EXPIRY_WARNING_DAYS } from '../_lib'

/** GET /api/prescriptions (Bearer) → my prescriptions (no image), newest first, with orderNo.
 *  APPROVED rows additionally carry reviewedAt / expiresAt / daysLeft / expiringSoon (90-day validity).
 *  Read-time side-effect: deduped 'expiring soon / expired' reminder notifications — never fails the GET. */
export async function GET(request: Request) {
  try {
    const user = await requireCustomer(request)
    if (user instanceof Response) return user
    const prescriptions = await db.prescription.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        note: true,
        status: true,
        reviewNote: true,
        reviewedAt: true,
        createdAt: true,
        updatedAt: true,
        // A prescription can now back several orders; the list shows the one it was
        // uploaded with, which is the oldest.
        orders: { select: { id: true, orderNo: true }, orderBy: { createdAt: 'asc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
    })
    const rows = prescriptions.map((p) => ({
      id: p.id,
      note: p.note,
      status: p.status,
      reviewNote: p.reviewNote,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      orderNo: p.orders[0]?.orderNo ?? null,
      orderId: p.orders[0]?.id ?? null,
      ...rxExpiryFields(p.status, p.reviewedAt),
    }))
    await sendExpiryReminders(user.id, rows)
    return Response.json({ prescriptions: rows })
  } catch (e) {
    return serverError(e)
  }
}

/**
 * Best-effort reminder notifications for APPROVED prescriptions within the warning window
 * (daysLeft ≤ RX_EXPIRY_WARNING_DAYS, including expired). Deduped per user via title +
 * message containing the [rx:<id>] token. A failure here must NEVER fail the GET.
 */
async function sendExpiryReminders(
  userId: string,
  rows: { id: string; status: string; daysLeft: number | null; expiresAt: Date | null }[]
): Promise<void> {
  try {
    for (const p of rows) {
      if (p.status !== 'APPROVED' || p.daysLeft === null || p.daysLeft > RX_EXPIRY_WARNING_DAYS || !p.expiresAt) continue
      const title = p.daysLeft <= 0 ? 'Prescription expired' : 'Prescription expiring soon'
      const dateStr = p.expiresAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      const message =
        p.daysLeft <= 0
          ? `Your approved prescription [rx:${p.id}] expired on ${dateStr}. Please upload a fresh prescription for future orders.`
          : `Your approved prescription [rx:${p.id}] expires on ${dateStr} (${p.daysLeft} day${p.daysLeft === 1 ? '' : 's'} left). Please upload a fresh prescription for future orders.`
      const existing = await db.notification.findFirst({
        where: { userId, title, message: { contains: `[rx:${p.id}]` } },
      })
      if (!existing) await db.notification.create({ data: { userId, title, message } })
    }
  } catch {
    // reminder failure must not fail the GET — intentionally swallowed
  }
}

/** POST /api/prescriptions {image, note?} — upload a prescription image (data URL) */
export async function POST(request: Request) {
  try {
    const user = await requireCustomer(request)
    if (user instanceof Response) return user
    const body = await readJson(request)
    if (!body) return badRequest('Invalid request body')
    // Prefix-only validation let any size of payload through into the image column.
    const parsedImage = parseImageInput(body.image, { label: 'prescription image' })
    if ('error' in parsedImage) return badRequest(parsedImage.error)
    const note = typeof body.note === 'string' && body.note.trim() !== '' ? body.note.trim() : null
    const prescription = await db.prescription.create({
      data: { userId: user.id, image: parsedImage.data, note },
    })
    return Response.json({ prescription }, { status: 201 })
  } catch (e) {
    return serverError(e)
  }
}
