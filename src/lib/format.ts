export const DELIVERY_FEE = 60
export const FREE_DELIVERY_THRESHOLD = 2000

export function fmtBDT(amount: number): string {
  return `৳${amount.toLocaleString('en-BD', { maximumFractionDigits: 2 })}`
}

export function fmtDate(date: string | Date | null | undefined): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function fmtDateTime(date: string | Date | null | undefined): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function effectivePrice(m: { price: number; discountPrice?: number | null }): number {
  return m.discountPrice && m.discountPrice > 0 && m.discountPrice < m.price ? m.discountPrice : m.price
}

export function discountPercent(m: { price: number; discountPrice?: number | null }): number {
  if (!m.discountPrice || m.discountPrice <= 0 || m.discountPrice >= m.price) return 0
  return Math.round(((m.price - m.discountPrice) / m.price) * 100)
}

export function stockLabel(stock: number): { text: string; tone: 'in' | 'low' | 'out' } {
  if (stock <= 0) return { text: 'Out of Stock', tone: 'out' }
  if (stock <= 10) return { text: `Only ${stock} left`, tone: 'low' }
  return { text: 'In Stock', tone: 'in' }
}
