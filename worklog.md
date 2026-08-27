# MediPlus E-Pharmacy MVP — Worklog

Project: Next.js 16 (App Router) + TypeScript + Tailwind 4 + shadcn/ui + Prisma (SQLite) + Zustand.
Single visible route `/` (SPA view router via zustand `useAppStore.view`). All backend in `/api/*` route handlers.
Theme: emerald/teal pharmacy green, NO blue/indigo. Currency BDT (৳). Sticky footer required.

Demo accounts (seeded):
- ADMIN admin@medplus.com / Admin123!
- PHARMACIST pharmacist@medplus.com / Pharma123!
- DELIVERY delivery@medplus.com / Deliver123!
- CUSTOMER customer@medplus.com / Customer123!

---
Task ID: 1
Agent: main (Z.ai Code)
Task: Project foundation — database schema, seed data, shared libs, theme, app shell

Work Log:
- Designed full Prisma schema: User, Address, Category, Medicine, CartItem, Prescription, Order, OrderItem, Payment, Coupon, Notification. Pushed to SQLite (db/custom.db).
- Seeded: 8 categories, 26 medicines (5 prescription-required, some low-stock), 6 users (all 4 roles), 3 addresses, 2 prescriptions, 3 coupons (SAVE10, FIRST50, HEALTH15), 4 sample orders (DELIVERED x2, OUT_FOR_DELIVERY, PRESCRIPTION_REVIEW), notifications.
- Created src/lib/auth.ts — HS256 JWT (crypto), scrypt password hashing, getAuthUser/requireRole guards, error helpers.
- Created src/lib/types.ts — ALL shared types incl. Order/OrderStatus/AdminStats/PharmacistStats + ORDER_STATUS_FLOW/ORDER_STATUS_LABELS.
- Created src/lib/api.ts — client fetch helper `api<T>(path, {method, body})` w/ Bearer token, fileToCompressedDataUrl for Rx uploads.
- Created src/lib/store.ts — zustand store (persisted user): view router, authOpen, cartCount, filters, detailMedicine, successOrderNo.
- Created src/lib/format.ts — fmtBDT, fmtDate/DateTime, effectivePrice, discountPercent, stockLabel, DELIVERY_FEE=60, free delivery over ৳2000.
- globals.css: emerald/teal oklch theme, custom scrollbars, med-gradient, fade-up animation.
- layout.tsx: MediPlus metadata, sonner Toaster.
- page.tsx: app shell — Header / animated view switch / Footer (min-h-screen flex-col + sticky footer) / AuthModal + MedicineDetailModal.

Stage Summary:
- DB ready with rich demo data. Shared libs/types/store are FROZEN contracts — subagents must import, not modify them.
- API contract documented in subagent prompts (Task 2-a/b/c). Product images generating to /public/images (hero.png, cat-*.png, med-*.png) — UI must gracefully fall back to gradient placeholder if image missing.
- Order lifecycle: PENDING → PRESCRIPTION_REVIEW → CONFIRMED → PROCESSING → OUT_FOR_DELIVERY → DELIVERED (+ CANCELLED/FAILED). Non-Rx orders go CONFIRMED immediately on placement (stock deducted); Rx orders wait for pharmacist approval. Cancel restocks.

---
Task ID: 2-c
Agent: frontend-styling-expert (subagent)
Task: Staff dashboards UI — Admin / Pharmacist / Delivery (src/components/admin|pharmacist|delivery)

Work Log:
- Created 17 files, all 'use client', default exports, strict TS, no `any`. Only imports from src/lib + src/components/ui + same folder (no cross-dashboard imports, no frozen-file edits).
- MedImage helper (copied per folder: admin/pharmacist/delivery) — img with onError → med-gradient fallback + white Pill icon; used for medicine images and prescription dataURLs.
- AdminDashboard: sticky w-56 sidebar (top-[64px], h-[calc(100vh-64px)]) + mobile horizontal-scroll segmented pill row; tabs overview/orders/medicines/categories/users/staff/reports with per-tab title+subtitle; framer-motion tab transition; defensive user-null / role-mismatch fallbacks.
- AdminOverview: 6 stat cards (Users, Orders, Revenue ৳, Pending Orders amber, Pending Prescriptions amber, Low Stock red), AreaChart revenueByDay (emerald #10b981 gradient fill, fmtBDT tooltip), PieChart statusCounts (hex palette map, legend), Recent Orders table (max-h-96 scroll, View all → orders tab), low-stock mini-list with Out/Low chips.
- AdminOrders: status Select + search toolbar (client filter); table w/ mono orderNo, items count, staff, status badge; Manage Dialog: customer/address blocks, items table, prescription (image max-h-64 + status chip + reviewNote), payment chip, totals breakdown, update zone (status Select all 8 + delivery staff Select from ?resource=staff) → PUT update-order → list+dialog refresh + toast; skeleton rows + empty state.
- AdminMedicines: search + Add; table w/ MedImage thumb, category chip, effective price + strike original, stock chip (0 gray Out / ≤10 red Low / else emerald), Rx chip, ACTIVE status Switch, expiry (red if expired), Edit + AlertDialog Delete. Shared in-file Add/Edit dialog validates name/price>0/stock≥0/discount<price; create/update via PUT {action:create-medicine|update-medicine}; image hint "leave empty for placeholder".
- AdminCategories: card grid w/ medicineCount chip, add/edit dialog (name*, description), AlertDialog delete warning "medicines become uncategorized".
- AdminUsers: search + role filter; table w/ Avatar initial, inline role Select → AlertDialog confirm → update-user role, status Switch → update-user (both disabled for own account), joined date.
- AdminStaff: Pharmacists (Pill) & Delivery Staff (Bike) cards with counts + joined dates; Add Staff dialog (name/email/password*, phone, role PHARMACIST|DELIVERY) → create-staff.
- AdminReports: days Select 7/30 → reports; BarChart salesByDay (revenue emerald + orders teal, dual Y axes), horizontal BarChart categorySales (teal); Top Medicines table with medal icons for ranks 1–3; Low Stock table (stock chips, price) + "Consider restocking" hint.
- PharmacistDashboard: w-52 sidebar, default tab prescriptions with amber pending-count badge (stats fetched in shell, refreshable); header shows pharmacist name; same mobile segmented row pattern.
- PharmacistOverview: 5 stat cards (Pending amber, Approved/Rejected today, Total Medicines, Low Stock red), low-stock Alert list w/ Pill icons + chips, quick actions (Review queue → prescriptions tab, Refresh).
- PharmacistPrescriptions: Tabs Pending/Approved/Rejected/All with counts (client filter); card grid w/ dataURL thumbnail, patient info, note line-clamp-2, orderNo chip, date, status badge; review Dialog (full image max-h-[65vh] object-contain, patient/order info, reviewNote textarea, "Approving will confirm the linked order and deduct stock" info Alert) → PUT review APPROVED/REJECTED (note required for reject, enforced) → toast + refetch + stats refresh.
- PharmacistMedicines: like admin minus delete, /api/pharmacist endpoints, categories via GET /api/categories; inline stock quick-edit (+/− buttons, clamp ≥0), status Switch, add/edit dialog.
- PharmacistOrders: read-only status Select + search + table w/ Rx chip (any item requiresPrescription); Dialog with flow timeline (ORDER_STATUS_FLOW progress dots), Rx rows highlighted amber, address/payment/totals, info alert pointing to Prescriptions tab.
- DeliveryDashboard: emerald→teal gradient hero (greeting, role chip, 3 mini stat tiles: Active/On the way/Delivered); Tabs Active/History. Active cards (1/2 cols): orderNo + status badge, customer + tel: Call button, MapPin full address, scrollable items list w/ thumbnails, payment chip (COD → amber "Collect ৳N on delivery", BKASH_DEMO → emerald "Paid via bKash"); status actions: PROCESSING → "Picked up — Out for delivery" (Truck), OUT_FOR_DELIVERY → green Mark Delivered + outline-destructive Report Failed (note Dialog) → PUT /api/delivery, optimistic active/history move + refetch + toasts. History table: orderNo/date/city/total/status/statusNote. PackageOpen empty states.
- Shared style repeated per file: status badge tone map (PENDING/PRESCRIPTION_REVIEW amber, PRESCRIPTION_REVIEW outline variant, CONFIRMED emerald, PROCESSING teal, OUT_FOR_DELIVERY emerald-700, DELIVERED emerald-600, CANCELLED gray, FAILED red), payment tones, Radix-safe 'ALL'/'NONE' select values, overflow-x-auto tables, max-h-96 scrollbar-thin lists, skeleton loaders for every fetch, per-row pending/disabled states, sonner toasts.

Stage Summary:
- All three staff dashboards complete against the frozen lib contracts and Task 2-a API contract; page.tsx imports resolve (AdminDashboard/PharmacistDashboard/DeliveryDashboard).
- eslint (bunx eslint on the 3 folders): 0 errors, 0 warnings. tsc --noEmit: 0 errors in these folders (remaining repo errors are pre-existing examples/scripts/skills scaffolding, not app code).
- Contract assumptions: status/search filtering for orders, medicines and users done client-side after full fetch (MVP-sized data); deliveryStaffId sent as null when "Unassigned"; reviewNote omitted when empty on approve; failed-delivery note optional; reports lowStock typed as Medicine[]; delivery PUT body {orderId, status, note?}. No files outside the three dashboard folders were touched.


---
Task ID: 2-b
Agent: frontend-styling-expert (subagent)
Task: Customer storefront UI — Header, Footer, Home, Catalog, Medicine card/detail, Cart, Checkout, Orders, Prescriptions, Profile, Auth modal

Work Log:
- Read frozen contracts (store.ts, api.ts, types.ts, format.ts, page.tsx, globals.css) and the shadcn/ui inventory; built exclusively under src/components/store/.
- MedicineCard.tsx — default card (clickable + keyboard accessible, discount/Rx badges, out-of-stock overlay, stock tone, fmtBDT price row, 44px add-to-cart icon button) + two shared exports: `MedImage` (renders src, falls back to med-gradient + white Pill icon on error/absence) and `addToCart(medicine, qty)` (guard → auth modal + toast.info, POST /api/cart, setCartCount, success/error toasts, returns boolean).
- Header.tsx — sticky bg-card/90 backdrop-blur; emerald-600 announcement bar (fmtBDT(2000)); mobile Sheet (search + nav + role dashboard + login/logout); desktop nav with active text-primary highlighting; search form → setFilters+catalog; cart button w/ count badge; notifications Popover (fetch on open, unread dots, mark-all-read PUT); avatar DropdownMenu (role dashboard for ADMIN/PHARMACIST/DELIVERY, orders, prescriptions, profile, red Log Out) or Sign in button.
- Footer.tsx — emerald-950 4-column footer (brand/licensed demo chip, quick links, support + hotline/email/Dhaka, payment chips), bottom bar © year, safe-area padding via env(safe-area-inset-bottom).
- HomeView.tsx — framer-motion section mounts; hero (med-gradient shapes, hero.png via MedImage, 2 CTAs, trust chips); 4-card feature strip; categories grid (GET /api/categories, cat-<slug>.png fallback, click → filters+catalog); Deals of the week (GET /api/medicines?featured=true, MedicineCard grid + View all); gradient 3-step prescription banner w/ CTA; skeletons per async section.
- CatalogView.tsx — sticky sidebar (categories w/ counts, price min/max + Apply, Rx-only Switch, clear all) reused inside a mobile Filters Sheet; toolbar w/ live result count + sort Select (featured/price/name/newest); search chip w/ clear; 2→3-col MedicineCard grid; Prev/Next pagination; AbortController cleanup; loading is DERIVED from filter key (no sync setState in effect — passes react-hooks/set-state-in-effect); empty + fetch-error states w/ retry.
- MedicineDetailModal.tsx — store-driven Dialog; keyed DetailBody resets qty per medicine; stock/unit/expiry rows, Rx amber Alert, qty stepper (clamped to stock), live subtotal, add-to-cart (closes on success).
- CartView.tsx — sign-in guard, skeleton loading, line items w/ optimistic qty update + revert-on-error (PUT /api/cart) and remove (DELETE /api/cart?itemId=), sticky summary (subtotal, delivery note, amber Rx alert), checkout + continue-shopping, empty state, cartCount synced after every mutation.
- AddressFormDialog.tsx — shared add/edit address Dialog (label Select, recipient/phone/line1/area/city/postcode, default Switch, required-field validation) → POST/PUT /api/addresses; used by Checkout + Profile.
- CheckoutView.tsx — parallel load of cart+addresses(+prescriptions if Rx items); radio address cards + add-address dialog; prescription card (Tabs: select APPROVED radio / upload new w/ fileToCompressedDataUrl preview + pharmacist note) only when cart has Rx items; COD vs bKash (Demo) RadioGroup; summary with coupon apply (POST /api/coupons → chip + remove), FREE delivery ≥ ৳2000 else DELIVERY_FEE, discount, total; Place Order disabled until address (+prescription) chosen; success Dialog (CheckCircle2, order no, Rx review note, Track order / Continue shopping) + setSuccessOrderNo + setCartCount(0).
- OrdersView.tsx — order cards (mono orderNo, tone-mapped status Badge per spec, 3 thumbnails + "+N", total, delivery staff); Cancel (AlertDialog → PUT action:cancel, only PENDING/PRESCRIPTION_REVIEW/CONFIRMED/PROCESSING), Reorder (PUT action:reorder → cart count → cart view); detail Dialog fetches GET /api/orders?id= — vertical ORDER_STATUS_FLOW stepper (done CheckCircle2 / pulsing current dot / muted upcoming, PRESCRIPTION_REVIEW step shown only for Rx orders), red banner for CANCELLED/FAILED, items Table, address + payment/status chips, totals w/ coupon, prescription image + status + reviewNote, delivery staff.
- PrescriptionsView.tsx — dashed upload card (fileToCompressedDataUrl preview + note, submit → POST /api/prescriptions, prepends, resets), 30-min review Info Alert, grid list w/ FileText placeholder, note, date, PENDING/APPROVED/REJECTED badges, pharmacist reviewNote.
- ProfileView.tsx — profile card (avatar/email/role chip, name+phone → PUT /api/auth → setUser), change-password card (client match/length validation → PUT), addresses card (grid, default badge, set-default/edit/delete w/ AlertDialog, shared AddressFormDialog).
- AuthModal.tsx — Tabs sign-in/register with shared email state; password Eye show/hide; login/register → POST /api/auth → store.login → toast + non-CUSTOMER role redirect; demo accounts box (4 seeded creds) with click-to-fill rows; toast.error on failures.

Stage Summary:
- All 13 storefront components created under src/components/store/ (Header, Footer, HomeView, CatalogView, MedicineCard (+MedImage/addToCart exports), MedicineDetailModal, CartView, AddressFormDialog, CheckoutView, OrdersView, PrescriptionsView, ProfileView, AuthModal) — exactly the default exports page.tsx imports; zero edits to frozen files.
- ESLint clean (`bunx eslint src/components/store` → 0 problems) and `tsc --noEmit` clean for src/** (remaining repo errors are pre-existing in examples/scripts/skills). No `any`, every file 'use client', strict props, mobile-first grids, ≥44px touch targets, skeletons/empty states everywhere, no blue/indigo, all currency via fmtBDT.
- Assumptions for API (Task 2-a): /api/medicines supports featured&limit&sort&page params and clamps out-of-range page via returned `page`; category cards fall back to /images/cat-<slug>.png when category.image is null; PUT /api/addresses accepts {id, ...fields} incl. isDefault; reorder returns {items} used only for count; list endpoints for orders/prescriptions/notifications may omit heavy fields (UI degrades gracefully).

---
Task ID: 2-a
Agent: backend-api (Z.ai Code)
Task: Backend API — all 12 route handlers under src/app/api per the frozen API contract

Work Log:
- Created src/app/api/_lib.ts (only non-route file, underscore-prefixed): readJson body parser, numParam/numOr/round2, publicUser (strips password), addressFromJson/addressToJson/parseAddressInput, orderInclude + parseOrder (maps addressJson→address, items, prescription w/o image unless opted in, deliveryStaff, payment, user), notify(), resolveCoupon (percent w/ maxDiscount cap, fixed capped at subtotal, minAmount + expiry checks), buildMedicineData (create/update validation shared by pharmacist+admin), slugify, parseCategoryInput.
- auth/route.ts: register (unique email, pw>=6, CUSTOMER, JWT), login (401 'Invalid email or password', 403 'Account is deactivated'), GET me, PUT profile (name/phone; password change verifies currentPassword).
- addresses/route.ts: GET (default first), POST (isDefault or first→true, unset others), PUT (ownership, partial, default switching), DELETE ?id=.
- categories/route.ts: public GET with ACTIVE medicineCount, ordered by name.
- medicines/route.ts: GET ?id= (ACTIVE or 404) + list: search(name/genericName/brand contains), category id-or-slug, minPrice/maxPrice (price OR discountPrice range), rxOnly, featured(8), sorts featured/price-asc/price-desc(JS effective price)/name-asc/name-desc/newest, page/limit(12, max 50), only ACTIVE, include category.
- cart/route.ts: GET (newest first, med+category), POST (ACTIVE check 'Medicine not available', 'Out of stock', qty=min(existing+req, stock)), PUT (ownership, clamp 1..stock, ACTIVE), DELETE one/clear.
- prescriptions/route.ts: GET mine newest-first WITHOUT image + orderNo; POST data:image validation ('Please upload a valid image').
- coupons/route.ts: public POST code+subtotal → CouponInfo; messages 'Invalid coupon code'/'This coupon has expired'/'Minimum order ৳N required'.
- orders/route.ts: POST place — cart load, ACTIVE+stock validation ('Insufficient stock for <name>'), addressId|inline address (created inside tx, isDefault if first) else 'Delivery address required', paymentMethod validation, subtotal=(discountPrice??price)*qty, deliveryFee 0>=2000 else 60, coupon via resolveCoupon, needsRx branches (approved prescriptionId→CONFIRMED+deduct; new prescription image→PRESCRIPTION_REVIEW, no deduction, Payment PENDING; else 'Prescription required for prescription items'), orderNo MP-{100000+count+1} with P2002 retry (+1..+5), Payment row (BKASH_DEMO PAID w/ demo txn id), cart cleared, 'Order placed' notification, returns parsed order (rx without image). GET list (newest, rx w/o image), GET ?id= (ownership, rx WITH image). PUT cancel (cancellable statuses, restock if CONFIRMED/PROCESSING/OUT_FOR_DELIVERY, PAID→REFUNDED+Payment REFUNDED, 'Order cancelled' notification), PUT reorder (ACTIVE+stock>0, qty=min(item.qty, stock), upsert).
- notifications/route.ts: GET (take 30 + unread count), PUT read-all.
- pharmacist/route.ts: GET stats (pending/approvedToday/rejectedToday via updatedAt>=00:00, ACTIVE counts, lowStock<=10 take 10), prescriptions (WITH image, user, orderNo, status filter), medicines (ALL incl INACTIVE, search), orders (user+items+address, PRESCRIPTION_REVIEW first via JS sort). PUT review (PENDING→APPROVED/REJECTED, 'Already reviewed' guard; APPROVED: stock check BEFORE approve ('Insufficient stock for <name>'), deduct, order→CONFIRMED, Payment if missing, 2 notifications; REJECTED: order→CANCELLED, notification w/ reason), create-medicine, update-medicine.
- admin/route.ts: GET stats (totalUsers CUSTOMER, orders/revenue excl CANCELLED, pendingOrders, revenueByDay last 7 'Mon 3' labels incl zero days, statusCounts groupBy, topSelling top5 from OrderItems, lowStock, recentOrders 8), users (search name/email, role filter, NO password), medicines, categories (counts), orders (status+search on orderNo/user, rx WITH image), staff, reports (days=7|30, salesByDay '3 Jan', categorySales, topMedicines, lowStock). PUT update-user (self-demotion/self-deactivation blocked 400), create-staff (PHARMACIST|DELIVERY, unique email, pw>=6), create/update/delete-medicine (delete→INACTIVE + cart cleanup), create/update/delete-category (slug regenerated, unique name 400), update-order (valid status, CONFIRMED from PENDING|PRESCRIPTION_REVIEW→stock check+deduct+Payment if missing ('Insufficient stock for <name>'), CANCELLED→restock if CONFIRMED/PROCESSING/OUT_FOR_DELIVERY + PAID→REFUNDED, statusNote 'Updated by admin', notification w/ ORDER_STATUS_LABELS title; deliveryStaffId must have DELIVERY role).
- delivery/route.ts: GET active (PROCESSING|OUT_FOR_DELIVERY) + history (DELIVERED|FAILED take 30), items+address+user+payment fields. PUT {orderId, status OUT_FOR_DELIVERY|DELIVERED|FAILED, note?} — must be assigned to me; transitions PROCESSING→any / OUT_FOR_DELIVERY→DELIVERED|FAILED; statusNote note||'Updated by delivery staff'; DELIVERED+COD→paymentStatus PAID + Payment PAID; customer notifications.
- Verification: `bunx eslint src/app/api` → 0 errors/warnings; `bunx tsc --noEmit` → 0 errors in src/app/api (remaining tsc errors are in page.tsx/components owned by UI agents). Ran direct handler-invocation smoke test covering the full lifecycle (register/login, cart→order→cancel→restock→reorder, Rx order w/ approved prescription, PRESCRIPTION_REVIEW→admin confirm→assign delivery→OUT_FOR_DELIVERY→DELIVERED COD→PAID, coupons, addresses default switching, pharmacist stats/review, admin stats/reports/staff CRUD, role guards 401/403, self-demotion block). Smoke-test entities cleaned from DB afterwards (seeded demo data intact: 6 users, 4 orders, 26 meds, 8 cats, 2 rxs).

Stage Summary:
- All 12 API routes + _lib.ts complete and contract-compliant. NOTE for UI agents: smoke test initially returned 500s over HTTP because page.tsx currently imports not-yet-created components (AuthModal, DeliveryDashboard, etc.) which breaks the Next dev build globally — API routes themselves are verified working via direct handler tests; once page.tsx compiles they will respond normally on port 3000.
- Deviations (minor, additive only): orders POST returns 201; prescription objects include `note` alongside id/status/reviewNote/createdAt; parsed orders include a small `payment` summary object; cart DELETE with unknown itemId → 404; INACTIVE medicine in cart order flow → '<name> is no longer available' (stock error keeps contract wording 'Insufficient stock for <name>').

---
Task ID: 3
Agent: main (Z.ai Code)
Task: Integration, end-to-end verification and fixes across all roles

Work Log:
- Integrated all subagent outputs; full-project ESLint passes (exit 0), tsc clean for src/.
- API smoke tests (curl): register/login, categories, medicines (featured/search/detail), cart add/update/clear, coupon validation (SAVE10 min-amount guard correct), order place (COD, CONFIRMED, correct fees), cancel (restock), reorder, Rx-without-prescription correctly rejected, pharmacist stats, admin stats/reports, delivery active/history.
- Browser verification (agent-browser):
  - Customer: home renders (hero, categories w/ generated images, deals), auth modal + demo quick-fill login, catalog filters/sort/search ("vitamin" -> 2 results), add-to-cart (badge + toast), cart qty stepper, checkout (address radios, COD/bKash, coupon UI), order placed MP-100006 success dialog, My Orders list with status badges, detail dialog with tracking timeline.
  - Pharmacist: auto-redirect to pharmacy desk, pending Rx queue, approve-with-note flow -> linked order MP-100003 became CONFIRMED (stock deducted).
  - Admin: overview stats/charts/recent orders/low stock live, manage-order dialog -> status PROCESSING + assign Jamal Uddin, medicines table + Add Medicine dialog (created "Vitamin C 500mg"), reports (sales-by-day, category bars).
  - Delivery: hero stats, assigned orders, "Picked up — Out for delivery" -> "Mark Delivered" full lifecycle on MP-100006.
  - Prescription upload: registered new user (Rahim), uploaded test image -> compressed preview -> submitted -> PENDING in list.
  - Mobile 390px: hamburger sheet, compact header, 2-col grid, footer sticks correctly.
- Fixed a11y: added sr-only DialogTitle to OrdersView + AdminOrders loading states.
- Generated 20 product/category images (19 seeded + hero retrying); z-ai CLI rate-limits caused some failures — background retry loop running (scripts/retry-images.sh); UI has graceful med-gradient fallback.

Stage Summary:
- MVP COMPLETE: all 4 role flows work end-to-end in the browser. Auth (JWT), catalog, cart, coupons, prescription gate, checkout (COD + bKash demo), order lifecycle, delivery assignment, notifications, admin CRUD + reports.
- Pending: 16 images regenerating in background (fallback safe), demo data intact, dev server healthy on port 3000.

---
Task ID: 4 (webDevReview round 2)
Agent: main (Z.ai Code)
Task: QA pass, bug fixes, dark mode, wishlist, expiring-soon panel, printable invoice

Work Log (Current project status):
- QA via agent-browser found 1 real bug: MedImage hydration race — images that 404'd BEFORE React attached onError rendered as broken (hero). Fixed in all 3 MedImage copies (store/MedicineCard.tsx, admin/MedImage.tsx, pharmacist/MedImage.tsx) with a ref callback checking `complete && naturalWidth===0` on mount.
- Nav "My Orders" wrapped to 2 lines → added whitespace-nowrap.
- Stale-state incidents: (1) dev server held OLD Prisma client after WishlistItem model push → /api/wishlist 500 'Cannot read properties of undefined (reading findMany)'; old next-server (PID survived bun wrapper kill) kept serving stale code + stale Turbopack CSS cache (same CSS chunk hash pre/post restart). FIX: kill next dev + next-server tree, `rm -rf .next`, restart `bun run dev`. Lesson for future rounds: after prisma db push, restart next-server properly (kill `next dev` AND `next-server` PIDs, clear .next if CSS looks stale).

Work Log (New features):
- WISHLIST (full stack): Prisma WishlistItem model (unique userId+medicineId, cascade); /api/wishlist GET(list+ids)/POST(toggle)/DELETE; store: wishlistIds + toggleWishlistId + 'wishlist' View; MedicineCard heart button (fill-red when saved, works for guests → auth prompt); WishlistView (skeletons, empty state, add-all-in-stock-to-cart, live sync when unhearting from cards); header heart w/ count badge + nav link + dropdown item.
- DARK MODE: next-themes ThemeProvider in layout (class attribute, light default); CSS-driven Sun/Moon toggle in header (no hydration mismatch); new dark palette (emerald-tinted dark surfaces, oklch); scoped `.dark` overrides in globals.css remap tone badges (bg-emerald-100/amber-100/red-100/gray-100, text-*), white overlays (white/60|70|90), med-gradient → coherent dark equivalents across ALL components without touching each file.
- PHARMACIST EXPIRING-SOON: /api/pharmacist stats now include expiringSoon (ACTIVE, expiry ≤ 90d, asc, take 10) + expiringSoonCount; PharmacistOverview shows 'Expiring within 90 days' card with day-countdown badges (red ≤30d/'Expired', amber ≤90d); seeded 5 medicines with near/expired dates (Savoy -5d, Torex 20d, Cef-3 45d, Amoxin 75d, Fungin 85d).
- PRINTABLE INVOICE: src/lib/invoice.ts — standalone print window with branded layout (logo, order meta w/ payment+status, billed-to, delivery staff, coupon, items table w/ Rx marks, totals, footer); 'Print invoice' button in customer order detail dialog; popup blocked → error toast.

Work Log (Verification results):
- ESLint full src: 0 problems. tsc src/: clean.
- Wishlist API cycle tested via curl (add → list 1 → remove). Browser: hearted 3 items → badge '3', wishlist view renders, unheart from card → '2 saved', add-all-in-stock → cart 2.
- Dark mode verified across home/catalog/pharmacist dashboards (dark hero, legible outline buttons, badges readable).
- Invoice popup opened (tab 'Invoice MP-100006') with correct PAID/DELIVERED data, ৳ totals, items table.
- Expiring panel shows Expired/20d/45d/75d/85d badges correctly.
- Images: 35/35 generated (hero needed 1344x768 — API rejects non-32-multiple sizes like 1440x720).
- Final: fresh light-mode home with real hero photo, catalog with real product photos, 27 medicines.

Stage Summary:
- App is feature-complete for MVP + wishlist + dark mode + expiry tracking + invoices. All roles verified again post-changes.
- Risks/notes: Turbopack cache can serve stale CSS after heavy edits (rm -rf .next fixes); Prisma model additions REQUIRE next-server restart (kill both PIDs); z-ai image sizes must be 32-multiples within 512-2880px.
- Next round suggestions: customer-side 'recommended/expiring-soon discount' automation, order prescription re-upload on reject, admin export CSV reports, email/SMS-style notification center page, stock movement audit log, product Q&A, or multi-image medicine gallery.
