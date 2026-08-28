/* Seed script for MediPlus E-Pharmacy MVP */
import { PrismaClient } from '@prisma/client'
import { randomBytes, scryptSync, createHmac } from 'crypto'

const prisma = new PrismaClient()

// ---------- crypto helpers (mirror src/lib/auth.ts) ----------
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function signJwt(payload: Record<string, unknown>, secret: string, expiresInSeconds = 60 * 60 * 24 * 7): string {
  const header = { alg: 'HS256', typ: 'JWT' }
  const body = { ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + expiresInSeconds }
  const h = Buffer.from(JSON.stringify(header)).toString('base64url')
  const p = Buffer.from(JSON.stringify(body)).toString('base64url')
  const sig = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')
  return `${h}.${p}.${sig}`
}

const JWT_SECRET = process.env.JWT_SECRET || 'medplus-epharm-dev-secret'

function daysFromNow(n: number) {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000)
}
function daysAgo(n: number) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000)
}

async function main() {
  console.log('Clearing existing data...')
  await prisma.notification.deleteMany()
  await prisma.payment.deleteMany()
  await prisma.orderItem.deleteMany()
  await prisma.order.deleteMany()
  await prisma.prescription.deleteMany()
  await prisma.cartItem.deleteMany()
  await prisma.address.deleteMany()
  await prisma.coupon.deleteMany()
  await prisma.auditLog.deleteMany() // audit rows survive user deletes via SetNull — clear them explicitly
  await prisma.medicine.deleteMany() // cascades PurchaseOrder + StockMovement + HelpfulVote rows
  await prisma.category.deleteMany()
  await prisma.user.deleteMany()

  // ---------- Users ----------
  console.log('Seeding users...')
  const admin = await prisma.user.create({
    data: { name: 'Dr. Ayesha Rahman', email: 'admin@medplus.com', phone: '+880 1711-000001', role: 'ADMIN', password: hashPassword('Admin123!') },
  })
  const pharmacist = await prisma.user.create({
    data: { name: 'Rakib Hasan', email: 'pharmacist@medplus.com', phone: '+880 1711-000002', role: 'PHARMACIST', password: hashPassword('Pharma123!') },
  })
  const delivery = await prisma.user.create({
    data: { name: 'Jamal Uddin', email: 'delivery@medplus.com', phone: '+880 1711-000003', role: 'DELIVERY', password: hashPassword('Deliver123!') },
  })
  const delivery2 = await prisma.user.create({
    data: { name: 'Sohel Rana', email: 'delivery2@medplus.com', phone: '+880 1711-000004', role: 'DELIVERY', password: hashPassword('Deliver123!') },
  })
  const customer = await prisma.user.create({
    data: { name: 'Tanvir Ahmed', email: 'customer@medplus.com', phone: '+880 1811-234567', role: 'CUSTOMER', password: hashPassword('Customer123!') },
  })
  const customer2 = await prisma.user.create({
    data: { name: 'Nusrat Jahan', email: 'nusrat@example.com', phone: '+880 1911-345678', role: 'CUSTOMER', password: hashPassword('Customer123!') },
  })

  // ---------- Categories ----------
  console.log('Seeding categories...')
  const catData = [
    { name: 'Pain Relief', slug: 'pain-relief', description: 'Tablets, gels & balms for headaches, body pain and fever', image: '/images/cat-pain-relief.png' },
    { name: 'Antibiotics', slug: 'antibiotics', description: 'Prescription antibiotics for bacterial infections', image: '/images/cat-antibiotics.png' },
    { name: 'Vitamins & Supplements', slug: 'vitamins-supplements', description: 'Daily vitamins, minerals and immunity boosters', image: '/images/cat-vitamins.png' },
    { name: 'Cold & Flu', slug: 'cold-flu', description: 'Relief for cough, cold, sore throat and congestion', image: '/images/cat-cold-flu.png' },
    { name: 'Diabetes Care', slug: 'diabetes-care', description: 'Glucose meters, test strips and diabetic medicines', image: '/images/cat-diabetes.png' },
    { name: 'Skin Care', slug: 'skin-care', description: 'Creams, ointments and dermatological treatments', image: '/images/cat-skin-care.png' },
    { name: 'Heart & BP', slug: 'heart-bp', description: 'Blood pressure and cardiovascular medicines', image: '/images/cat-heart-bp.png' },
    { name: 'First Aid', slug: 'first-aid', description: 'Bandages, antiseptics and emergency care essentials', image: '/images/cat-first-aid.png' },
  ]
  const categories: Record<string, string> = {}
  for (const c of catData) {
    const cat = await prisma.category.create({ data: c })
    categories[c.slug] = cat.id
  }

  // ---------- Medicines ----------
  console.log('Seeding medicines...')
  const meds: Array<{
    name: string; genericName?: string; brand?: string; manufacturer?: string; description?: string;
    category: string; price: number; discountPrice?: number; stock: number; unit?: string;
    requiresPrescription?: boolean; image?: string; expiresInDays?: number;
  }> = [
    { name: 'Napa Extra 500mg+65mg', genericName: 'Paracetamol + Caffeine', brand: 'Beximco', manufacturer: 'Beximco Pharmaceuticals', description: 'Fast relief for headache, migraine, fever and body pain. Each tablet contains Paracetamol 500mg and Caffeine 65mg.', category: 'pain-relief', price: 30, discountPrice: 25, stock: 320, unit: 'strip', image: '/images/med-napa.png', expiresInDays: 540 },
    { name: 'Ace 500mg', genericName: 'Paracetamol', brand: 'Square', manufacturer: 'Square Pharmaceuticals', description: 'Paracetamol tablets for fever and mild to moderate pain relief.', category: 'pain-relief', price: 25, stock: 480, unit: 'strip', image: '/images/med-ace.png', expiresInDays: 600 },
    { name: 'Flamerin Gel 30g', genericName: 'Diclofenac Diethylamine', brand: 'Acme', manufacturer: 'The ACME Laboratories', description: 'Topical anti-inflammatory gel for joint pain, sprains and muscular pain.', category: 'pain-relief', price: 95, discountPrice: 85, stock: 85, unit: 'tube', image: '/images/med-flamerin.png', expiresInDays: 400 },
    { name: 'Seclo 20mg', genericName: 'Omeprazole', brand: 'Square', manufacturer: 'Square Pharmaceuticals', description: 'Proton pump inhibitor for gastric ulcer, reflux and heartburn.', category: 'pain-relief', price: 70, stock: 150, unit: 'strip', requiresPrescription: true, image: '/images/med-seclo.png', expiresInDays: 480 },
    { name: 'Azyth 500mg', genericName: 'Azithromycin', brand: 'Incepta', manufacturer: 'Incepta Pharmaceuticals', description: 'Broad spectrum antibiotic for respiratory, skin and soft tissue infections.', category: 'antibiotics', price: 120, stock: 95, unit: 'strip', requiresPrescription: true, image: '/images/med-azyth.png', expiresInDays: 420 },
    { name: 'Cef-3 400mg', genericName: 'Cefixime Trihydrate', brand: 'Square', manufacturer: 'Square Pharmaceuticals', description: 'Third generation cephalosporin antibiotic capsules.', category: 'antibiotics', price: 210, discountPrice: 189, stock: 60, unit: 'strip', requiresPrescription: true, image: '/images/med-cef3.png', expiresInDays: 380 },
    { name: 'Amoxin 500mg', genericName: 'Amoxicillin', brand: 'Acme', manufacturer: 'The ACME Laboratories', description: 'Penicillin-class antibiotic capsule for bacterial infections.', category: 'antibiotics', price: 90, stock: 8, unit: 'strip', requiresPrescription: true, image: '/images/med-amoxin.png', expiresInDays: 350 },
    { name: 'Savoy Ointment 20g', genericName: 'Turpentine Oil', brand: 'GSK', manufacturer: 'GlaxoSmithKline Bangladesh', description: 'Soathing ointment for blocked nose, muscle stiffness and insect bites.', category: 'cold-flu', price: 55, stock: 110, unit: 'piece', image: '/images/med-savoy.png', expiresInDays: 700 },
    { name: 'Fexo 120mg', genericName: 'Fexofenadine Hydrochloride', brand: 'Square', manufacturer: 'Square Pharmaceuticals', description: 'Non-drowsy antihistamine for seasonal allergy and hay fever.', category: 'cold-flu', price: 85, discountPrice: 76, stock: 140, unit: 'strip', requiresPrescription: true, image: '/images/med-fexo.png', expiresInDays: 500 },
    { name: 'Torex Syrup 100ml', genericName: 'Herbal Cough Syrup', brand: 'Natural', manufacturer: 'Hall-Mark Pharmaceuticals', description: 'Herbal cough syrup for dry and productive cough. Suitable for adults and children.', category: 'cold-flu', price: 75, stock: 175, unit: 'bottle', image: '/images/med-torex.png', expiresInDays: 300 },
    { name: 'Maxpro Vitamin D3 2000 IU', genericName: 'Cholecalciferol', brand: 'Beximco', manufacturer: 'Beximco Pharmaceuticals', description: 'Vitamin D3 capsules for strong bones and immunity support.', category: 'vitamins-supplements', price: 180, discountPrice: 162, stock: 220, unit: 'strip', image: '/images/med-maxpro-d3.png', expiresInDays: 720 },
    { name: 'Neuro-B Tablet', genericName: 'Vitamin B1+B6+B12', brand: 'Square', manufacturer: 'Square Pharmaceuticals', description: 'Vitamin B-complex for nerve health and neuropathy support.', category: 'vitamins-supplements', price: 100, stock: 260, unit: 'strip', image: '/images/med-neurob.png', expiresInDays: 650 },
    { name: 'Zinconia 50mg', genericName: 'Zinc Sulphate', brand: 'Acme', manufacturer: 'The ACME Laboratories', description: 'Zinc supplement for immunity, growth and wound healing.', category: 'vitamins-supplements', price: 60, stock: 300, unit: 'strip', image: '/images/med-zinconia.png', expiresInDays: 550 },
    { name: 'Sodium Bicarbonate BP', genericName: 'Sodium Bicarbonate', brand: 'ACI', manufacturer: 'ACI Limited', description: 'Antacid powder for acidity and indigestion relief.', category: 'pain-relief', price: 20, stock: 400, unit: 'piece', image: '/images/med-sodibicarb.png', expiresInDays: 800 },
    { name: 'Glucometer Elite Kit', genericName: 'Blood Glucose Meter', brand: 'Accu-Chek', manufacturer: 'Roche Diabetes Care', description: 'Digital glucose monitoring kit with lancing device, 10 test strips and carry case.', category: 'diabetes-care', price: 1450, discountPrice: 1299, stock: 25, unit: 'box', image: '/images/med-glucometer.png', expiresInDays: 900 },
    { name: 'Glucophage 500mg', genericName: 'Metformin Hydrochloride', brand: 'Merck', manufacturer: 'Merck Serono', description: 'First-line oral medicine for type 2 diabetes mellitus.', category: 'diabetes-care', price: 65, stock: 190, unit: 'strip', requiresPrescription: true, image: '/images/med-glucophage.png', expiresInDays: 460 },
    { name: 'Test Strip Pack (50)', genericName: 'Glucose Test Strips', brand: 'Accu-Chek', manufacturer: 'Roche Diabetes Care', description: 'Pack of 50 compatible glucose test strips with fast 5-second results.', category: 'diabetes-care', price: 550, stock: 40, unit: 'box', image: '/images/med-strips.png', expiresInDays: 400 },
    { name: 'Cetaphil Gentle Cleanser 125ml', genericName: 'Skin Cleanser', brand: 'Galderma', manufacturer: 'Galderma', description: 'Soap-free gentle cleanser for sensitive and dry skin.', category: 'skin-care', price: 720, discountPrice: 648, stock: 55, unit: 'bottle', image: '/images/med-cetaphil.png', expiresInDays: 730 },
    { name: 'Fungin Cream 15g', genericName: 'Clotrimazole', brand: 'Square', manufacturer: 'Square Pharmaceuticals', description: 'Antifungal cream for ringworm, athlete\'s foot and candidiasis.', category: 'skin-care', price: 60, stock: 130, unit: 'tube', image: '/images/med-fungin.png', expiresInDays: 500 },
    { name: 'Amodis Cream 25g', genericName: 'Mometasone Furoate', brand: 'Acme', manufacturer: 'The ACME Laboratories', description: 'Topical corticosteroid cream for eczema, psoriasis and dermatitis.', category: 'skin-care', price: 110, stock: 70, unit: 'tube', requiresPrescription: true, image: '/images/med-amodis.png', expiresInDays: 430 },
    { name: 'Bisocor 5mg', genericName: 'Bisoprolol Fumarate', brand: 'Square', manufacturer: 'Square Pharmaceuticals', description: 'Beta-blocker for hypertension, angina and heart failure.', category: 'heart-bp', price: 90, stock: 160, unit: 'strip', requiresPrescription: true, image: '/images/med-bisocor.png', expiresInDays: 520 },
    { name: 'Ecosprin 75mg', genericName: 'Aspirin', brand: 'Beximco', manufacturer: 'Beximco Pharmaceuticals', description: 'Low dose aspirin tablets for cardiovascular protection.', category: 'heart-bp', price: 35, discountPrice: 30, stock: 350, unit: 'strip', requiresPrescription: true, image: '/images/med-ecosprin.png', expiresInDays: 610 },
    { name: 'Digital BP Monitor', genericName: 'Blood Pressure Monitor', brand: 'Omron', manufacturer: 'Omron Healthcare', description: 'Automatic upper-arm blood pressure monitor with irregular heartbeat detection.', category: 'heart-bp', price: 3900, discountPrice: 3490, stock: 12, unit: 'box', image: '/images/med-bpmonitor.png', expiresInDays: 900 },
    { name: 'Savlon Antiseptic 100ml', genericName: 'Chlorhexidine Gluconate', brand: 'ITC', manufacturer: 'ITC Limited', description: 'Antiseptic liquid for wound cleaning and first aid use.', category: 'first-aid', price: 85, stock: 145, unit: 'bottle', image: '/images/med-savlon.png', expiresInDays: 800 },
    { name: 'Crepe Bandage 4 inch', genericName: 'Elastic Bandage', brand: 'Dhaka', manufacturer: 'Dhaka Medical Aids', description: 'Elastic crepe bandage providing firm support for sprains and swelling.', category: 'first-aid', price: 120, stock: 6, unit: 'piece', image: '/images/med-bandage.png', expiresInDays: 1000 },
    { name: 'Digital Thermometer', genericName: 'Clinical Thermometer', brand: 'Omron', manufacturer: 'Omron Healthcare', description: 'Fast and accurate digital thermometer with fever alarm and memory.', category: 'first-aid', price: 250, discountPrice: 225, stock: 90, unit: 'piece', image: '/images/med-thermometer.png', expiresInDays: 1200 },
  ]

  const medIds: Record<string, { id: string; price: number; discountPrice: number | null; name: string; image: string | null; requiresPrescription: boolean }> = {}
  for (const m of meds) {
    const med = await prisma.medicine.create({
      data: {
        name: m.name,
        genericName: m.genericName,
        brand: m.brand,
        manufacturer: m.manufacturer,
        description: m.description,
        categoryId: categories[m.category],
        price: m.price,
        discountPrice: m.discountPrice ?? null,
        stock: m.stock,
        unit: m.unit ?? 'piece',
        requiresPrescription: m.requiresPrescription ?? false,
        image: m.image ?? null,
        expiryDate: m.expiresInDays ? daysFromNow(m.expiresInDays) : null,
      },
    })
    medIds[m.name] = { id: med.id, price: med.discountPrice ?? med.price, discountPrice: med.discountPrice ?? null, name: med.name, image: med.image, requiresPrescription: med.requiresPrescription }
  }

  // ---------- Coupons ----------
  console.log('Seeding coupons...')
  await prisma.coupon.createMany({
    data: [
      { code: 'SAVE10', type: 'PERCENT', value: 10, minAmount: 300, maxDiscount: 200 },
      { code: 'FIRST50', type: 'FIXED', value: 50, minAmount: 500 },
      { code: 'HEALTH15', type: 'PERCENT', value: 15, minAmount: 1000, maxDiscount: 300 },
    ],
  })

  // ---------- Addresses ----------
  console.log('Seeding addresses...')
  const addr1 = await prisma.address.create({
    data: { userId: customer.id, label: 'Home', recipient: 'Tanvir Ahmed', phone: '+880 1811-234567', line1: 'House 42, Road 11, Block C', area: 'Banani', city: 'Dhaka', postcode: '1213', isDefault: true },
  })
  await prisma.address.create({
    data: { userId: customer.id, label: 'Office', recipient: 'Tanvir Ahmed', phone: '+880 1811-234567', line1: 'Level 8, Awal Centre, 18 Kemal Ataturk Ave', area: 'Gulshan 2', city: 'Dhaka', postcode: '1212' },
  })
  const addr2 = await prisma.address.create({
    data: { userId: customer2.id, label: 'Home', recipient: 'Nusrat Jahan', phone: '+880 1911-345678', line1: 'Flat 5B, Sheltech Panorama, 211 Shahid Sayed Nazrul Islam Sarani', area: 'Mirpur DOHS', city: 'Dhaka', postcode: '1216', isDefault: true },
  })

  // ---------- Prescriptions ----------
  console.log('Seeding prescriptions...')
  const rxApproved = await prisma.prescription.create({
    data: {
      userId: customer.id,
      image: 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#f0fdf4"/><text x="200" y="150" text-anchor="middle" font-family="Arial" font-size="16" fill="#166534">Sample Prescription - Dr. S. Karim</text></svg>').toString('base64'),
      note: 'Prescribed by Dr. S. Karim, Square Hospital',
      status: 'APPROVED',
      reviewNote: 'Valid prescription, medicines verified.',
      reviewedById: pharmacist.id,
      // Round 10 — backdated so the 90-day approval-expiry demo fires (expires in ~5 days)
      reviewedAt: daysAgo(85),
    },
  })
  await prisma.prescription.create({
    data: {
      userId: customer2.id,
      image: 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#fef9ec"/><text x="200" y="150" text-anchor="middle" font-family="Arial" font-size="16" fill="#92400e">Sample Prescription - Dr. M. Chowdhury</text></svg>').toString('base64'),
      note: 'For blood pressure follow-up',
      status: 'PENDING',
    },
  })

  // ---------- Sample Orders ----------
  console.log('Seeding sample orders...')
  const addr1Snap = JSON.stringify({ label: 'Home', recipient: 'Tanvir Ahmed', phone: '+880 1811-234567', line1: 'House 42, Road 11, Block C', area: 'Banani', city: 'Dhaka', postcode: '1213' })
  const addr2Snap = JSON.stringify({ label: 'Home', recipient: 'Nusrat Jahan', phone: '+880 1911-345678', line1: 'Flat 5B, Sheltech Panorama', area: 'Mirpur DOHS', city: 'Dhaka', postcode: '1216' })

  // Order 1: delivered (customer, non-Rx)
  const o1items = [medIds['Napa Extra 500mg+65mg'], medIds['Neuro-B Tablet'], medIds['Savlon Antiseptic 100ml']]
  let subtotal = o1items.reduce((s, m) => s + m.price, 0)
  const o1 = await prisma.order.create({
    data: {
      orderNo: 'MP-100001', userId: customer.id, addressJson: addr1Snap,
      subtotal, discount: 0, deliveryFee: 60, total: subtotal + 60,
      paymentMethod: 'COD', paymentStatus: 'PAID', status: 'DELIVERED',
      createdAt: daysAgo(6), updatedAt: daysAgo(4),
      items: { create: o1items.map((m) => ({ medicineId: m.id, name: m.name, price: m.price, quantity: 1, image: m.image, requiresPrescription: m.requiresPrescription })) },
    },
  })
  await prisma.payment.create({ data: { orderId: o1.id, method: 'COD', status: 'PAID', amount: subtotal + 60 } })

  // Order 2: out for delivery (customer, assigned to delivery)
  const o2items = [medIds['Maxpro Vitamin D3 2000 IU'], medIds['Zinconia 50mg']]
  subtotal = o2items.reduce((s, m) => s + m.price, 0)
  const o2 = await prisma.order.create({
    data: {
      orderNo: 'MP-100002', userId: customer.id, addressJson: addr1Snap,
      subtotal, discount: 0, deliveryFee: 60, total: subtotal + 60,
      paymentMethod: 'COD', paymentStatus: 'PENDING', status: 'OUT_FOR_DELIVERY',
      deliveryStaffId: delivery.id,
      createdAt: daysAgo(1), updatedAt: new Date(),
      items: { create: o2items.map((m) => ({ medicineId: m.id, name: m.name, price: m.price, quantity: 2, image: m.image, requiresPrescription: m.requiresPrescription })) },
    },
  })
  await prisma.payment.create({ data: { orderId: o2.id, method: 'COD', status: 'PENDING', amount: subtotal + 60 } })

  // Order 3: prescription review (customer2)
  const o3items = [medIds['Glucophage 500mg']]
  subtotal = o3items.reduce((s, m) => s + m.price, 0)
  const o3 = await prisma.order.create({
    data: {
      orderNo: 'MP-100003', userId: customer2.id, addressJson: addr2Snap,
      subtotal, discount: 0, deliveryFee: 60, total: subtotal + 60,
      paymentMethod: 'COD', paymentStatus: 'PENDING', status: 'PRESCRIPTION_REVIEW',
      prescriptionId: (await prisma.prescription.findFirst({ where: { userId: customer2.id } }))!.id,
      createdAt: daysAgo(0), updatedAt: daysAgo(0),
      items: { create: o3items.map((m) => ({ medicineId: m.id, name: m.name, price: m.price, quantity: 1, image: m.image, requiresPrescription: m.requiresPrescription })) },
    },
  })
  await prisma.payment.create({ data: { orderId: o3.id, method: 'COD', status: 'PENDING', amount: subtotal + 60 } })

  // Order 4: delivered for customer2 (used in reports)
  const o4items = [medIds['Ace 500mg'], medIds['Torex Syrup 100ml']]
  subtotal = o4items.reduce((s, m) => s + m.price, 0)
  const o4 = await prisma.order.create({
    data: {
      orderNo: 'MP-100004', userId: customer2.id, addressJson: addr2Snap,
      subtotal, discount: 0, deliveryFee: 60, total: subtotal + 60,
      paymentMethod: 'BKASH_DEMO', paymentStatus: 'PAID', status: 'DELIVERED',
      deliveryStaffId: delivery2.id,
      createdAt: daysAgo(3), updatedAt: daysAgo(2),
      items: { create: o4items.map((m) => ({ medicineId: m.id, name: m.name, price: m.price, quantity: 1, image: m.image, requiresPrescription: m.requiresPrescription })) },
    },
  })
  await prisma.payment.create({ data: { orderId: o4.id, method: 'BKASH_DEMO', status: 'PAID', amount: subtotal + 60 } })

  // ---------- Notifications ----------
  await prisma.notification.createMany({
    data: [
      { userId: customer.id, title: 'Order delivered', message: 'Your order MP-100001 has been delivered. Get well soon!' },
      { userId: customer.id, title: 'Out for delivery', message: 'Order MP-100002 is on the way. Jamal Uddin will deliver your parcel.' },
      { userId: customer.id, title: 'Prescription approved', message: 'Your prescription has been approved by our pharmacist.' },
    ],
  })

  // ---------- Purchase Orders (Round 10) ----------
  console.log('Seeding purchase orders...')
  const poSeeds = [
    { medName: 'Amoxin 500mg', qty: 100, status: 'RECEIVED', note: 'Supplier: Square Pharma', orderedAt: daysAgo(7), receivedAt: daysAgo(5) as Date | null },
    { medName: 'Crepe Bandage 4 inch', qty: 60, status: 'ORDERED', note: 'Supplier: Square Pharma', orderedAt: daysAgo(2), receivedAt: null as Date | null },
    { medName: 'Digital BP Monitor', qty: 10, status: 'ORDERED', note: 'Supplier: Roche Distributor', orderedAt: daysAgo(1), receivedAt: null as Date | null },
  ]
  let receivedPoId: string | null = null
  for (const s of poSeeds) {
    const med = medIds[s.medName]
    if (!med) continue
    // idempotent guard: skip when an identical (medicineId, qty, status, note) PO already exists
    const existing = await prisma.purchaseOrder.findFirst({ where: { medicineId: med.id, qty: s.qty, status: s.status, note: s.note } })
    if (existing) {
      if (s.status === 'RECEIVED') receivedPoId = existing.id
      continue
    }
    const po = await prisma.purchaseOrder.create({
      data: {
        medicineId: med.id,
        qty: s.qty,
        status: s.status,
        note: s.note,
        orderedById: pharmacist.id,
        receivedById: s.status === 'RECEIVED' ? pharmacist.id : null,
        orderedAt: s.orderedAt,
        receivedAt: s.receivedAt,
      },
    })
    if (s.status === 'RECEIVED') receivedPoId = po.id
  }

  // ---------- Audit Log samples (Round 10) ----------
  console.log('Seeding audit log samples...')
  const auditSeeds = [
    { actorId: pharmacist.id, actorName: pharmacist.name ?? 'Pharmacist', actorEmail: pharmacist.email, actorRole: pharmacist.role, action: 'RX_REVIEW', entityType: 'PRESCRIPTION', entityRef: rxApproved.id, detail: 'Approved prescription for customer@medplus.com', createdAt: daysAgo(6) },
    { actorId: admin.id, actorName: admin.name ?? 'Admin', actorEmail: admin.email, actorRole: admin.role, action: 'PAYMENT_STATUS', entityType: 'PAYMENT', entityRef: 'MP-100001', detail: 'Payment status set to PAID', createdAt: daysAgo(4) },
    ...(receivedPoId ? [{ actorId: pharmacist.id, actorName: pharmacist.name ?? 'Pharmacist', actorEmail: pharmacist.email, actorRole: pharmacist.role, action: 'PO_RECEIVE', entityType: 'PURCHASE_ORDER', entityRef: receivedPoId, detail: 'Received 100 × Amoxin 500mg', createdAt: daysAgo(5) }] : []),
  ]
  for (const a of auditSeeds) {
    // idempotent guard: skip when an identical (action, entityRef, detail) entry already exists
    const existing = await prisma.auditLog.findFirst({ where: { action: a.action, entityRef: a.entityRef, detail: a.detail } })
    if (existing) continue
    await prisma.auditLog.create({ data: a })
  }

  // ---------- Auth tokens for quick demo login (informational) ----------
  const demoAccounts = [
    { role: 'ADMIN', email: 'admin@medplus.com', password: 'Admin123!' },
    { role: 'PHARMACIST', email: 'pharmacist@medplus.com', password: 'Pharma123!' },
    { role: 'DELIVERY', email: 'delivery@medplus.com', password: 'Deliver123!' },
    { role: 'CUSTOMER', email: 'customer@medplus.com', password: 'Customer123!' },
    { role: 'CUSTOMER', email: 'nusrat@example.com', password: 'Customer123!' },
  ]
  console.log('\n✅ Seed complete!\nDemo accounts (JWT_SECRET=' + JWT_SECRET.slice(0, 6) + '...):')
  for (const a of demoAccounts) console.log(`  ${a.role.padEnd(11)} ${a.email.padEnd(28)} ${a.password}`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
