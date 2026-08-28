import type { Order } from '@/lib/types'
import { fmtBDT, fmtDateTime } from '@/lib/format'

/**
 * Builds a clean printable invoice for an order and opens the browser print
 * dialog in a standalone window (works regardless of app theme).
 */
export function printInvoice(order: Order, shopName = 'MediPlus Pharmacy') {
  const addr = order.address
  const rows = order.items
    .map(
      (i) => `<tr>
        <td>${escapeHtml(i.name)}${i.requiresPrescription ? ' <span style="color:#b45309">(Rx)</span>' : ''}</td>
        <td style="text-align:center">${i.quantity}</td>
        <td style="text-align:right">${fmtBDT(i.price)}</td>
        <td style="text-align:right">${fmtBDT(i.price * i.quantity)}</td>
      </tr>`
    )
    .join('')

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Invoice ${order.orderNo}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #111827; padding: 32px; max-width: 760px; margin: 0 auto; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #059669; padding-bottom: 16px; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .logo { width: 40px; height: 40px; border-radius: 10px; background: #059669; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 800; }
  .brand h1 { font-size: 20px; }
  .brand small { color: #6b7280; display: block; font-weight: 400; }
  .meta { text-align: right; font-size: 13px; color: #374151; }
  .meta .no { font-family: ui-monospace, monospace; font-weight: 700; font-size: 15px; color: #111827; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; margin: 20px 0 6px; }
  .cols { display: flex; gap: 24px; }
  .cols > div { flex: 1; font-size: 13px; line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }
  th { text-align: left; background: #ecfdf5; color: #065f46; padding: 8px 10px; border: 1px solid #d1fae5; }
  th:nth-child(2), td:nth-child(2) { text-align: center; }
  th:nth-child(3), td:nth-child(3), th:nth-child(4), td:nth-child(4) { text-align: right; }
  td { padding: 8px 10px; border: 1px solid #e5e7eb; }
  .totals { margin-top: 14px; margin-left: auto; width: 280px; font-size: 13px; }
  .totals div { display: flex; justify-content: space-between; padding: 3px 0; }
  .totals .grand { border-top: 2px solid #111827; margin-top: 6px; padding-top: 8px; font-weight: 800; font-size: 15px; }
  .foot { margin-top: 36px; border-top: 1px solid #e5e7eb; padding-top: 12px; font-size: 11px; color: #6b7280; text-align: center; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <div class="head">
    <div class="brand">
      <div class="logo">M+</div>
      <div><h1>${escapeHtml(shopName)}</h1><small>Genuine medicines, delivered</small></div>
    </div>
    <div class="meta">
      <div class="no">${escapeHtml(order.orderNo)}</div>
      <div>${fmtDateTime(order.createdAt)}</div>
      <div>Payment: ${methodLabel(order.paymentMethod)} · ${escapeHtml(order.paymentStatus)}</div>
      <div>Status: ${escapeHtml(order.status.replaceAll('_', ' '))}</div>
    </div>
  </div>

  <div class="cols">
    <div>
      <h2>Billed to</h2>
      <strong>${escapeHtml(addr.recipient ?? '')}</strong><br/>
      ${escapeHtml(addr.line1 ?? '')}${addr.area ? ', ' + escapeHtml(addr.area) : ''}<br/>
      ${escapeHtml(addr.city ?? '')}${addr.postcode ? ' ' + escapeHtml(addr.postcode) : ''}<br/>
      ${escapeHtml(addr.phone ?? '')}
    </div>
    <div>
      <h2>Delivery</h2>
      ${order.deliveryStaff ? `${escapeHtml(order.deliveryStaff.name ?? 'Courier')}<br/>${escapeHtml(order.deliveryStaff.phone ?? '')}<br/>` : ''}
      ${order.couponCode ? `Coupon: <strong>${escapeHtml(order.couponCode)}</strong><br/>` : ''}
      ${order.statusNote ? escapeHtml(order.statusNote) : ''}
    </div>
  </div>

  <h2>Items</h2>
  <table>
    <thead><tr><th>Medicine</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="totals">
    <div><span>Subtotal</span><span>${fmtBDT(order.subtotal)}</span></div>
    ${order.discount > 0 ? `<div><span>Discount</span><span>− ${fmtBDT(order.discount)}</span></div>` : ''}
    <div><span>Delivery fee</span><span>${order.deliveryFee === 0 ? 'FREE' : fmtBDT(order.deliveryFee)}</span></div>
    <div class="grand"><span>Total</span><span>${fmtBDT(order.total)}</span></div>
  </div>

  ${
    order.notes
      ? `<h2>Delivery notes</h2>
  <div style="font-size:12px; line-height:1.5; border:1px solid #e5e7eb; background:#f9fafb; padding:9px 10px; border-radius:6px;">${escapeHtml(order.notes)}</div>`
      : ''
  }

  <div class="foot">
    This is a computer-generated invoice for demo purposes. · ${escapeHtml(shopName)} · Hotline 09611-MEDPLUS
  </div>

  <script>window.onload = function () { window.print(); };</script>
</body>
</html>`

  const win = window.open('', '_blank', 'width=820,height=900')
  if (!win) return false
  win.document.write(html)
  win.document.close()
  return true
}

function methodLabel(m: string) {
  return m === 'BKASH_DEMO' ? 'bKash' : m === 'COD' ? 'Cash on Delivery' : m
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
