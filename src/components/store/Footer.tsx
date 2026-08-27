'use client'

import { Pill, ShieldCheck } from 'lucide-react'
import { useAppStore, type View } from '@/lib/store'

const quickLinks: { view: View; label: string }[] = [
  { view: 'catalog', label: 'Shop' },
  { view: 'catalog', label: 'Categories' },
  { view: 'cart', label: 'Cart' },
  { view: 'orders', label: 'My Orders' },
]

const paymentChips = ['Cash on Delivery', 'bKash (Demo)', 'Visa']

export default function Footer() {
  const setView = useAppStore((s) => s.setView)

  return (
    <footer
      className="mt-12 bg-emerald-950 text-emerald-50"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4 lg:px-6">
        {/* Brand */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-lg bg-emerald-600">
              <Pill className="size-5 text-white" aria-hidden="true" />
            </span>
            <span className="text-lg font-bold">MediPlus</span>
          </div>
          <p className="text-sm leading-relaxed text-emerald-200/90">
            Genuine medicines and health essentials, delivered to your door — fast, safe and
            affordable.
          </p>
          <p className="inline-flex items-center gap-1.5 rounded-full bg-emerald-900 px-3 py-1 text-xs text-emerald-200">
            <ShieldCheck className="size-3.5" aria-hidden="true" />
            Licensed online pharmacy demo
          </p>
        </div>

        {/* Quick links */}
        <div>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-emerald-300">
            Quick Links
          </h3>
          <ul className="space-y-1">
            {quickLinks.map((l, i) => (
              <li key={`${l.label}-${i}`}>
                <button
                  type="button"
                  onClick={() => {
                    if (l.label === 'Categories') {
                      setView('catalog')
                      return
                    }
                    setView(l.view)
                  }}
                  className="min-h-11 py-1 text-sm text-emerald-100/90 transition-colors hover:text-white hover:underline"
                >
                  {l.label}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Support */}
        <div>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-emerald-300">
            Support
          </h3>
          <ul className="space-y-1 text-sm text-emerald-100/90">
            <li>
              <button
                type="button"
                onClick={() => setView('prescriptions')}
                className="min-h-11 py-1 text-left transition-colors hover:text-white hover:underline"
              >
                How prescriptions work
              </button>
            </li>
            <li className="pt-1">
              <p className="font-medium text-emerald-50">Hotline: 09611-MEDIPLUS</p>
              <p className="text-emerald-200/80">support@medplus.com</p>
              <p className="text-emerald-200/80">Dhaka, Bangladesh</p>
            </li>
          </ul>
        </div>

        {/* Payment */}
        <div>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-emerald-300">
            Payment
          </h3>
          <div className="flex flex-wrap gap-2">
            {paymentChips.map((p) => (
              <span
                key={p}
                className="rounded-lg border border-emerald-800 bg-emerald-900/60 px-3 py-1.5 text-xs font-medium text-emerald-100"
              >
                {p}
              </span>
            ))}
          </div>
          <p className="mt-4 text-xs leading-relaxed text-emerald-300/80">
            All payments on this demo are simulated. No real money is charged.
          </p>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-emerald-900">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-1 px-4 py-4 text-xs text-emerald-300/80 sm:flex-row lg:px-6">
          <p>© {new Date().getFullYear()} MediPlus Pharmacy</p>
          <p>Made for demo purposes</p>
        </div>
      </div>
    </footer>
  )
}
