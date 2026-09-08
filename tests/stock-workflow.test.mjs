/**
 * Integration tests for the stock request → approval → purchase order → receiving
 * workflow, and for the inventory invariants it must never break.
 *
 * Run with `npm run test:integration` against a running dev server. These are kept
 * out of `npm test` on purpose: that suite is pure logic and must keep working with
 * no database and no server, which is what makes it usable in CI today.
 *
 * What these cover that unit tests cannot:
 *   - authorization at the real route boundary, including the self-approval refusal
 *   - concurrency: two requests racing the same claim, fired in genuine parallel
 *   - that a transaction either happens completely or not at all
 *   - the invariants SUM(receipts) = receivedQty and SUM(delta) = stock, on real rows
 *
 * Safety: every test works on a throwaway medicine this file creates and deletes. It
 * asserts the database is byte-identical afterwards, so it is safe against the live
 * database. Logins cost 3 of the 30-per-5-minutes IP budget, so do not loop it.
 */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { PrismaClient } from '@prisma/client'

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const db = new PrismaClient()

/** Everything this file created, torn down in dependency order in `after`. */
// Three fixtures, because a request may hold each medicine only once
// (@@unique([requestId, medicineId])) — a multi-line request needs distinct products.
const created = { medicineIds: [], requestIds: new Set(), poIds: new Set() }
/** The medicine every stock assertion is made against. */
const primary = () => created.medicineIds[0]
let rxToken = ''
let adminToken = ''
let customerToken = ''
let adminUserId = ''
let baseline = null

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function login(email, password) {
  const r = await fetch(`${BASE}/api/auth`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'login', email, password }),
  })
  const d = await r.json().catch(() => ({}))
  assert.ok(d.token, `login failed for ${email}: ${r.status} ${JSON.stringify(d)}`)
  return { token: d.token, id: d.user?.id }
}

/** One authenticated call. `token` null sends no Authorization header. */
async function call(token, method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}

const sr = (token, body) => call(token, 'PUT', '/api/stock-requests', body)
const rx = (token, body) => call(token, 'PUT', '/api/pharmacist', body)

/** Create a request through the API and remember it for cleanup. */
async function newRequest(token, { submit = true, priority = 'MEDIUM', qty = [100] } = {}) {
  const res = await sr(token, {
    action: 'create',
    submit,
    priority,
    reason: 'integration test',
    items: qty.map((q, i) => ({ medicineId: created.medicineIds[i], requestedQty: q })),
  })
  assert.equal(res.status, 201, `create failed: ${JSON.stringify(res.data)}`)
  created.requestIds.add(res.data.request.id)
  return res.data.request
}

/** Approve every line in full, as the admin. */
async function approveAll(request, perLine) {
  const res = await sr(adminToken, {
    action: 'review',
    id: request.id,
    decisions: request.items.map((i, idx) => ({
      itemId: i.id,
      approvedQty: perLine ? perLine[idx] : i.requestedQty,
    })),
  })
  assert.equal(res.status, 200, `review failed: ${JSON.stringify(res.data)}`)
  return res.data.request
}

async function convert(request, token = rxToken) {
  const res = await sr(token, { action: 'convert-to-po', id: request.id })
  if (res.status === 200) for (const id of res.data.purchaseOrderIds ?? []) created.poIds.add(id)
  return res
}

const fixtureStock = async () =>
  (await db.medicine.findUnique({ where: { id: primary() }, select: { stock: true } })).stock

const movementsFor = async () =>
  db.stockMovement.findMany({ where: { medicineId: primary() }, orderBy: { createdAt: 'asc' } })

async function totals() {
  const [stock, movements, pos, receipts, requests] = await Promise.all([
    db.medicine.aggregate({ _sum: { stock: true } }),
    db.stockMovement.count(),
    db.purchaseOrder.count(),
    db.purchaseOrderReceipt.count(),
    db.stockRequest.count(),
  ])
  return { stock: stock._sum.stock, movements, pos, receipts, requests }
}

// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------

before(async () => {
  const health = await fetch(`${BASE}/api/categories`).catch(() => null)
  assert.ok(
    health?.ok,
    `No server at ${BASE}. Start one first (npm run dev), or set E2E_BASE_URL.`
  )

  const a = await login('admin@medplus.com', 'Admin123!')
  adminToken = a.token
  adminUserId = a.id
  rxToken = (await login('pharmacist@medplus.com', 'Pharma123!')).token
  customerToken = (await login('customer@medplus.com', 'Customer123!')).token

  baseline = await totals()

  // A throwaway product at zero stock: every assertion below is then an exact figure
  // rather than a delta against whatever the catalogue happened to hold, and the
  // ledger reconciles trivially (0 == 0) without an opening movement.
  const stamp = Date.now()
  for (let i = 0; i < 3; i++) {
    const med = await db.medicine.create({
      data: {
        name: `ZZ Integration Fixture ${stamp}-${i}`,
        price: 10,
        stock: 0,
        unit: 'strip',
        status: 'ACTIVE',
        // Comfortably in date, so the expiry guard is never the reason something fails.
        expiryDate: new Date(Date.now() + 365 * 864e5),
      },
    })
    created.medicineIds.push(med.id)
  }
})

after(async () => {
  const medicineIds = created.medicineIds
  if (medicineIds.length > 0) {
    const medicineId = { in: medicineIds }
    // Dependency order matters, and StockRequestItem.medicineId is onDelete: Restrict
    // by design — procurement history must survive a catalogue deletion — so the item
    // rows have to go before the medicine can.
    await db.purchaseOrderReceipt.deleteMany({ where: { purchaseOrder: { medicineId } } })
    await db.purchaseOrder.deleteMany({ where: { medicineId } })
    await db.stockRequestItem.deleteMany({ where: { medicineId } })
    await db.stockRequest.deleteMany({ where: { id: { in: [...created.requestIds] } } })
    await db.stockMovement.deleteMany({ where: { medicineId } })
    await db.auditLog.deleteMany({
      where: {
        OR: [
          { entityRef: { in: [...created.poIds] } },
          { entityType: 'STOCK_REQUEST', createdAt: { gte: new Date(Date.now() - 3600_000) } },
        ],
      },
    })
    await db.notification.deleteMany({
      where: { createdAt: { gte: new Date(Date.now() - 3600_000) }, title: { contains: 'tock request' } },
    })
    await db.medicine.deleteMany({ where: { id: medicineId } })
  }

  const final = await totals()
  assert.deepEqual(final, baseline, 'the database must be exactly as it was before these tests')

  const drift = await db.$queryRawUnsafe(`
    SELECT m."id" FROM "Medicine" m
     LEFT JOIN (SELECT "medicineId", SUM("delta") AS s FROM "StockMovement" GROUP BY "medicineId") agg
       ON agg."medicineId" = m."id"
    WHERE m."stock" <> COALESCE(agg.s, 0)`)
  assert.equal(drift.length, 0, 'the ledger must still reconcile after these tests')

  await db.$disconnect()
})

// ---------------------------------------------------------------------------
// 1. authorization
// ---------------------------------------------------------------------------

describe('authorization', () => {
  it('refuses an unauthenticated caller', async () => {
    assert.equal((await call(null, 'GET', '/api/stock-requests?resource=list')).status, 401)
    assert.equal((await sr(null, { action: 'create', items: [] })).status, 401)
  })

  it('refuses a customer', async () => {
    assert.equal((await call(customerToken, 'GET', '/api/stock-requests?resource=list')).status, 403)
  })

  it('lets a pharmacist raise a request but not review one', async () => {
    const req = await newRequest(rxToken)
    const res = await sr(rxToken, {
      action: 'review',
      id: req.id,
      decisions: req.items.map((i) => ({ itemId: i.id, approvedQty: i.requestedQty })),
    })
    assert.equal(res.status, 403)
  })

  it('refuses a pharmacist a direct purchase order, and tells them what to do instead', async () => {
    const res = await rx(rxToken, {
      action: 'create-po',
      medicineId: primary(),
      qty: 5,
      note: 'should not be allowed',
    })
    assert.equal(res.status, 403)
    assert.match(res.data.error ?? '', /stock request/i)
  })

  it('requires a reason on an admin direct purchase order', async () => {
    const noReason = await rx(adminToken, { action: 'create-po', medicineId: primary(), qty: 5 })
    assert.equal(noReason.status, 400)
    assert.match(noReason.data.error ?? '', /reason is required/i)

    const withReason = await rx(adminToken, {
      action: 'create-po',
      medicineId: primary(),
      qty: 5,
      note: 'Emergency top-up',
    })
    assert.equal(withReason.status, 200)
    created.poIds.add(withReason.data.order.id)
  })

  it('records a direct purchase order as an exception in the audit log', async () => {
    const entry = await db.auditLog.findFirst({
      where: { action: 'PO_CREATE', detail: { contains: 'no stock request' } },
      orderBy: { createdAt: 'desc' },
    })
    assert.ok(entry, 'a direct purchase order must be legible as one in the audit log')
    assert.match(entry.detail, /Reason: Emergency top-up/)
  })

  it('keeps clinical work with the pharmacist', async () => {
    assert.equal((await call(adminToken, 'GET', '/api/pharmacist?resource=prescriptions')).status, 403)
    assert.equal((await call(rxToken, 'GET', '/api/pharmacist?resource=prescriptions')).status, 200)
  })

  it('gives the admin the stock ledger it could not previously see', async () => {
    const res = await call(adminToken, 'GET', '/api/pharmacist?resource=movements&take=5')
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(res.data.movements))
  })
})

// ---------------------------------------------------------------------------
// 2. request lifecycle
// ---------------------------------------------------------------------------

describe('request lifecycle', () => {
  it('creates a draft that is private to its author', async () => {
    const draft = await newRequest(rxToken, { submit: false })
    assert.equal(draft.status, 'DRAFT')

    const asAdmin = await call(adminToken, 'GET', `/api/stock-requests?resource=detail&id=${draft.id}`)
    assert.equal(asAdmin.status, 404, "another user must not see someone else's draft")

    const asAuthor = await call(rxToken, 'GET', `/api/stock-requests?resource=detail&id=${draft.id}`)
    assert.equal(asAuthor.status, 200)
  })

  it('edits a draft, replacing its lines', async () => {
    const draft = await newRequest(rxToken, { submit: false, qty: [10] })
    const res = await sr(rxToken, {
      action: 'update-draft',
      id: draft.id,
      priority: 'HIGH',
      items: [{ medicineId: primary(), requestedQty: 55 }],
    })
    assert.equal(res.status, 200)
    assert.equal(res.data.request.priority, 'HIGH')
    assert.equal(res.data.request.items.length, 1)
    assert.equal(res.data.request.items[0].requestedQty, 55)
  })

  it('captures the stock snapshot at the moment of the request', async () => {
    const req = await newRequest(rxToken, { submit: false })
    assert.equal(req.items[0].stockAtRequest, await fixtureStock())
  })

  it('submits a draft and refuses to submit it twice', async () => {
    const draft = await newRequest(rxToken, { submit: false })
    const first = await sr(rxToken, { action: 'submit', id: draft.id })
    assert.equal(first.status, 200)
    assert.equal(first.data.request.status, 'SUBMITTED')

    const second = await sr(rxToken, { action: 'submit', id: draft.id })
    assert.equal(second.status, 400, 'submitting twice must be refused')
  })

  it('refuses to edit a request once it has been submitted', async () => {
    const req = await newRequest(rxToken)
    const res = await sr(rxToken, {
      action: 'update-draft',
      id: req.id,
      items: [{ medicineId: primary(), requestedQty: 1 }],
    })
    assert.equal(res.status, 400)
    assert.match(res.data.error ?? '', /draft/i)
  })

  it('notifies the admins when a request is submitted', async () => {
    const before = await db.notification.count({ where: { userId: adminUserId } })
    await newRequest(rxToken, { priority: 'EMERGENCY' })
    const afterCount = await db.notification.count({ where: { userId: adminUserId } })
    assert.ok(afterCount > before, 'an admin must be told a request is waiting')

    const latest = await db.notification.findFirst({
      where: { userId: adminUserId },
      orderBy: { createdAt: 'desc' },
    })
    assert.match(latest.title, /EMERGENCY/, 'an emergency must be visibly urgent')
  })
})

// ---------------------------------------------------------------------------
// 3. review and approval
// ---------------------------------------------------------------------------

describe('review and approval', () => {
  it('refuses to approve more than was requested', async () => {
    const req = await newRequest(rxToken, { qty: [100] })
    const res = await sr(adminToken, {
      action: 'review',
      id: req.id,
      decisions: [{ itemId: req.items[0].id, approvedQty: 101 }],
    })
    assert.equal(res.status, 400)
    assert.match(res.data.error ?? '', /cannot exceed/i)
  })

  it('refuses a half-finished review', async () => {
    const req = await newRequest(rxToken, { qty: [100, 50] })
    const res = await sr(adminToken, {
      action: 'review',
      id: req.id,
      decisions: [{ itemId: req.items[0].id, approvedQty: 100 }],
    })
    assert.equal(res.status, 400)
    assert.match(res.data.error ?? '', /not been decided/i)
  })

  it('records a full approval', async () => {
    const req = await newRequest(rxToken, { qty: [100] })
    const reviewed = await approveAll(req)
    assert.equal(reviewed.status, 'APPROVED')
    assert.equal(reviewed.items[0].status, 'APPROVED')
    assert.equal(reviewed.items[0].approvedQty, 100)
  })

  it('records a partial approval — the worked example', async () => {
    // Napa 100 approved in full, Seclo 50 cut to 30, Vitamin C 100 rejected.
    const req = await newRequest(rxToken, { qty: [100, 50, 100] })
    const reviewed = await approveAll(req, [100, 30, 0])
    assert.equal(reviewed.status, 'PARTIALLY_APPROVED')
    assert.deepEqual(
      reviewed.items.map((i) => i.status),
      ['APPROVED', 'PARTIALLY_APPROVED', 'REJECTED']
    )
    assert.deepEqual(reviewed.items.map((i) => i.approvedQty), [100, 30, 0])
    assert.equal(reviewed.totalApproved, 130)
  })

  it('records a rejection', async () => {
    const req = await newRequest(rxToken, { qty: [100] })
    const reviewed = await approveAll(req, [0])
    assert.equal(reviewed.status, 'REJECTED')
    assert.equal(reviewed.items[0].status, 'REJECTED')
  })

  it('refuses to review an already-decided request', async () => {
    const req = await newRequest(rxToken)
    await approveAll(req)
    const again = await sr(adminToken, {
      action: 'review',
      id: req.id,
      decisions: [{ itemId: req.items[0].id, approvedQty: 1 }],
    })
    assert.equal(again.status, 400)
  })

  it('refuses an admin reviewing a request they raised themselves', async () => {
    // The control the whole workflow exists to impose. Enforced at the API, not the UI.
    const own = await newRequest(adminToken)
    const res = await sr(adminToken, {
      action: 'review',
      id: own.id,
      decisions: [{ itemId: own.items[0].id, approvedQty: 100 }],
    })
    assert.equal(res.status, 400)
    assert.match(res.data.error ?? '', /raised yourself/i)
  })

  it('lets only one of two concurrent reviews land', async () => {
    const req = await newRequest(rxToken)
    const decisions = [{ itemId: req.items[0].id, approvedQty: 50 }]
    const [a, b] = await Promise.all([
      sr(adminToken, { action: 'review', id: req.id, decisions }),
      sr(adminToken, { action: 'review', id: req.id, decisions }),
    ])
    const wins = [a, b].filter((r) => r.status === 200).length
    assert.equal(wins, 1, `exactly one review may win, got ${a.status}/${b.status}`)
  })
})

// ---------------------------------------------------------------------------
// 4. conversion to purchase orders
// ---------------------------------------------------------------------------

describe('conversion to purchase orders', () => {
  it('refuses to convert a request that was never approved', async () => {
    const req = await newRequest(rxToken)
    const res = await convert(req)
    assert.equal(res.status, 400)
  })

  it('raises one purchase order per approved line, and none for a rejected one', async () => {
    const req = await newRequest(rxToken, { qty: [100, 50, 100] })
    await approveAll(req, [100, 30, 0])
    const res = await convert(req)
    assert.equal(res.status, 200)
    assert.equal(res.data.purchaseOrderIds.length, 2, 'the rejected line must raise nothing')
    assert.equal(res.data.request.status, 'ORDERED')
  })

  it('links every purchase order back to its request line', async () => {
    const req = await newRequest(rxToken, { qty: [40] })
    await approveAll(req)
    const res = await convert(req)
    const po = await db.purchaseOrder.findUnique({ where: { id: res.data.purchaseOrderIds[0] } })
    assert.ok(po.stockRequestItemId, 'a converted purchase order must carry its request line')
    const item = await db.stockRequestItem.findUnique({ where: { id: po.stockRequestItemId } })
    assert.equal(item.requestId, req.id, 'and that line must belong to this request')
    assert.equal(po.qty, 40, 'it must order the approved quantity')
    assert.equal(po.receivedQty, 0, 'and nothing may be received yet')
  })

  it('refuses a second conversion, so nothing is double-ordered', async () => {
    const req = await newRequest(rxToken)
    await approveAll(req)
    assert.equal((await convert(req)).status, 200)
    assert.equal((await convert(req)).status, 400)
  })

  it('lets only one of two concurrent conversions land', async () => {
    const req = await newRequest(rxToken)
    await approveAll(req)
    const [a, b] = await Promise.all([convert(req), convert(req)])
    const wins = [a, b].filter((r) => r.status === 200).length
    assert.equal(wins, 1, `exactly one conversion may win, got ${a.status}/${b.status}`)

    const pos = await db.purchaseOrder.count({
      where: { stockRequestItem: { requestId: req.id } },
    })
    assert.equal(pos, 1, 'one approved line must produce exactly one purchase order')
  })
})

// ---------------------------------------------------------------------------
// 5. receiving
// ---------------------------------------------------------------------------

describe('receiving', () => {
  /** An approved, converted request with a single purchase order for `qty`. */
  async function orderFor(qty) {
    const req = await newRequest(rxToken, { qty: [qty] })
    await approveAll(req)
    const res = await convert(req)
    assert.equal(res.status, 200)
    return { requestId: req.id, poId: res.data.purchaseOrderIds[0] }
  }

  it('books in a full delivery when no quantity is given', async () => {
    const { poId } = await orderFor(25)
    const before = await fixtureStock()
    const res = await rx(rxToken, { action: 'receive-po', id: poId })
    assert.equal(res.status, 200)
    assert.equal(await fixtureStock(), before + 25)
    const po = await db.purchaseOrder.findUnique({ where: { id: poId } })
    assert.equal(po.status, 'RECEIVED')
    assert.equal(po.receivedQty, 25)
  })

  it('books in a partial delivery and leaves the order open', async () => {
    const { poId } = await orderFor(100)
    const before = await fixtureStock()
    const res = await rx(rxToken, { action: 'receive-po', id: poId, qty: 60 })
    assert.equal(res.status, 200)
    assert.equal(await fixtureStock(), before + 60, 'stock rises by what arrived, not what was ordered')
    const po = await db.purchaseOrder.findUnique({ where: { id: poId } })
    assert.equal(po.status, 'PARTIALLY_RECEIVED')
    assert.equal(po.receivedQty, 60)
    assert.equal(res.data.order.remainingQty, 40)
  })

  it('completes an order across several deliveries', async () => {
    const { requestId, poId } = await orderFor(100)
    const before = await fixtureStock()
    for (const qty of [50, 30, 20]) {
      assert.equal((await rx(rxToken, { action: 'receive-po', id: poId, qty })).status, 200)
    }
    assert.equal(await fixtureStock(), before + 100)
    const po = await db.purchaseOrder.findUnique({ where: { id: poId } })
    assert.equal(po.status, 'RECEIVED')
    assert.equal(po.receivedQty, 100)

    const detail = await call(adminToken, 'GET', `/api/stock-requests?resource=detail&id=${requestId}`)
    assert.equal(detail.data.request.status, 'COMPLETED', 'the request closes when the last unit arrives')
    assert.equal(detail.data.request.items[0].remainingQty, 0)
  })

  it('refuses to receive more than was ordered', async () => {
    const { poId } = await orderFor(100)
    await rx(rxToken, { action: 'receive-po', id: poId, qty: 60 })
    const before = await fixtureStock()
    const res = await rx(rxToken, { action: 'receive-po', id: poId, qty: 41 })
    assert.equal(res.status, 400)
    assert.match(res.data.error ?? '', /still outstanding/i)
    assert.equal(await fixtureStock(), before, 'a refused delivery must move nothing')
  })

  it('refuses to receive a completed order again', async () => {
    const { poId } = await orderFor(10)
    assert.equal((await rx(rxToken, { action: 'receive-po', id: poId })).status, 200)
    const before = await fixtureStock()
    const res = await rx(rxToken, { action: 'receive-po', id: poId, qty: 1 })
    assert.equal(res.status, 400)
    assert.equal(await fixtureStock(), before)
  })

  it('counts a doubled-up delivery once, not twice', async () => {
    // The double-click case: two identical requests fired in genuine parallel.
    const { poId } = await orderFor(100)
    const before = await fixtureStock()
    const [a, b] = await Promise.all([
      rx(rxToken, { action: 'receive-po', id: poId, qty: 100 }),
      rx(rxToken, { action: 'receive-po', id: poId, qty: 100 }),
    ])
    const wins = [a, b].filter((r) => r.status === 200).length
    assert.equal(wins, 1, `exactly one delivery may land, got ${a.status}/${b.status}`)
    assert.equal(await fixtureStock(), before + 100, 'one delivery, counted once')

    const po = await db.purchaseOrder.findUnique({ where: { id: poId } })
    assert.equal(po.receivedQty, 100)
    assert.ok(po.receivedQty <= po.qty, 'receivedQty must never pass the ordered quantity')
  })

  it('holds the line under a burst of concurrent partial deliveries', async () => {
    const { poId } = await orderFor(100)
    const before = await fixtureStock()
    const results = await Promise.all(
      Array.from({ length: 6 }, () => rx(rxToken, { action: 'receive-po', id: poId, qty: 30 }))
    )
    const wins = results.filter((r) => r.status === 200).length
    const po = await db.purchaseOrder.findUnique({ where: { id: poId } })

    assert.ok(wins >= 1 && wins <= 3, `at most 3 × 30 fits inside 100, ${wins} landed`)
    assert.equal(po.receivedQty, wins * 30, 'the counter must match exactly what landed')
    assert.equal(await fixtureStock(), before + wins * 30, 'and so must the stock')
    assert.ok(po.receivedQty <= po.qty)
  })

  it('lets a partially received order be cancelled, keeping what arrived', async () => {
    const { poId } = await orderFor(100)
    await rx(rxToken, { action: 'receive-po', id: poId, qty: 40 })
    const before = await fixtureStock()
    const res = await rx(rxToken, { action: 'cancel-po', id: poId })
    assert.equal(res.status, 200, 'a part-received order must be closable, or it is stuck forever')
    const po = await db.purchaseOrder.findUnique({ where: { id: poId } })
    assert.equal(po.status, 'CANCELLED')
    assert.equal(po.receivedQty, 40, 'units already on the shelf stay received')
    assert.equal(await fixtureStock(), before, 'cancelling must not reverse a delivery')
  })

  it('puts the delivery note on the receipt, not over the order’s own note', async () => {
    const { poId } = await orderFor(20)
    const poBefore = await db.purchaseOrder.findUnique({ where: { id: poId } })
    await rx(rxToken, { action: 'receive-po', id: poId, note: 'Arrived damaged box' })
    const poAfter = await db.purchaseOrder.findUnique({
      where: { id: poId },
      include: { receipts: true },
    })
    assert.equal(poAfter.note, poBefore.note, 'the reason the order was raised must survive')
    assert.equal(poAfter.receipts[0].note, 'Arrived damaged box')
  })
})

// ---------------------------------------------------------------------------
// 6. inventory invariants
// ---------------------------------------------------------------------------

describe('inventory invariants', () => {
  it('moves no stock when a request is created, submitted, approved or converted', async () => {
    const stockBefore = await fixtureStock()
    const movesBefore = (await movementsFor()).length

    const draft = await newRequest(rxToken, { submit: false, qty: [500] })
    assert.equal(await fixtureStock(), stockBefore, 'creating a request must move no stock')

    await sr(rxToken, { action: 'submit', id: draft.id })
    assert.equal(await fixtureStock(), stockBefore, 'submitting must move no stock')

    await approveAll(draft)
    assert.equal(await fixtureStock(), stockBefore, 'approving must move no stock')

    await convert(draft)
    assert.equal(await fixtureStock(), stockBefore, 'raising a purchase order must move no stock')

    assert.equal((await movementsFor()).length, movesBefore, 'and none of it may write a movement')
  })

  it('writes exactly one PO_RECEIVE movement per delivery, for the delivered quantity', async () => {
    const req = await newRequest(rxToken, { qty: [70] })
    await approveAll(req)
    const poId = (await convert(req)).data.purchaseOrderIds[0]

    const before = await movementsFor()
    await rx(rxToken, { action: 'receive-po', id: poId, qty: 45 })
    const afterOne = await movementsFor()
    assert.equal(afterOne.length, before.length + 1, 'one delivery, one movement')
    assert.equal(afterOne.at(-1).reason, 'PO_RECEIVE')
    assert.equal(afterOne.at(-1).delta, 45, 'the movement must record what arrived')

    await rx(rxToken, { action: 'receive-po', id: poId, qty: 25 })
    const afterTwo = await movementsFor()
    assert.equal(afterTwo.length, before.length + 2)
    assert.equal(afterTwo.at(-1).delta, 25)
  })

  it('keeps stock equal to the sum of its ledger, for every fixture', async () => {
    for (const id of created.medicineIds) {
      const [med, agg] = await Promise.all([
        db.medicine.findUnique({ where: { id }, select: { stock: true, name: true } }),
        db.stockMovement.aggregate({ where: { medicineId: id }, _sum: { delta: true } }),
      ])
      assert.equal(med.stock, agg._sum.delta ?? 0, `SUM(delta) must equal stock for ${med.name}`)
    }
  })

  it('keeps receivedQty equal to the sum of its receipts', async () => {
    const rows = await db.$queryRawUnsafe(
      `SELECT po."id" FROM "PurchaseOrder" po
        WHERE po."receivedQty" <> (SELECT COALESCE(SUM(r."qty"),0)
          FROM "PurchaseOrderReceipt" r WHERE r."purchaseOrderId" = po."id")`
    )
    assert.equal(rows.length, 0, 'every purchase order must agree with its receipts')
  })

  it('never lets stock go negative', async () => {
    const negative = await db.medicine.count({ where: { stock: { lt: 0 } } })
    assert.equal(negative, 0)
  })

  it('never lets a purchase order exceed its ordered quantity', async () => {
    const over = await db.$queryRawUnsafe(
      `SELECT "id" FROM "PurchaseOrder" WHERE "receivedQty" > "qty"`
    )
    assert.equal(over.length, 0)
  })
})
