'use client'

import { useState } from 'react'
import { Facebook, Instagram, MailCheck, Pill, Send, ShieldCheck, Twitter, Youtube } from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '@/lib/store'
import { canAccessView, type View } from '@/lib/rbac'

const quickLinks: { view: View; label: string }[] = [
  { view: 'catalog', label: 'Shop' },
  { view: 'catalog', label: 'Categories' },
  { view: 'cart', label: 'Cart' },
  { view: 'orders', label: 'My Orders' },
]

const paymentChips = ['Cash on Delivery', 'bKash (Demo)', 'Visa']

/** One heading treatment for every footer column, so they share a baseline and rhythm. */
const COLUMN_HEADING = 'text-sm font-semibold uppercase tracking-wider text-emerald-300'

/** Footer link row: a full-width 44px target, so a column of links reads as an even stack. */
const LINK_ROW =
  'flex min-h-11 w-full items-center text-left text-sm text-emerald-100/90 transition-colors hover:text-white hover:underline'

export default function Footer() {
  const setView = useAppStore((s) => s.setView)
  const role = useAppStore((s) => s.user?.role ?? null)
  // Same policy as the header: don't offer storefront links a staff role can't open.
  const visibleLinks = quickLinks.filter((l) => canAccessView(role, l.view))
  const [newsletterEmail, setNewsletterEmail] = useState('')
  const [subscribing, setSubscribing] = useState(false)

  const subscribe = () => {
    const email = newsletterEmail.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      toast.error('Please enter a valid email address')
      return
    }
    setSubscribing(true)
    window.setTimeout(() => {
      setSubscribing(false)
      setNewsletterEmail('')
      toast.success('Subscribed! Health tips are on their way to your inbox.')
    }, 700)
  }

  return (
    <footer
      className="mt-12 bg-emerald-950 text-emerald-50"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* Newsletter band */}
      <div className="border-b border-emerald-900 bg-gradient-to-r from-emerald-900/60 via-emerald-900/20 to-teal-900/40">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 lg:flex-row lg:items-center lg:justify-between lg:px-6">
          <div className="flex items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-800/80">
              <MailCheck className="size-5 text-emerald-200" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-base font-bold sm:text-lg">Health tips, offers & reminders</h2>
              <p className="text-sm text-emerald-200/80">
                One useful email a month — no spam, unsubscribe anytime.
              </p>
            </div>
          </div>
          <form
            className="flex w-full max-w-md items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              subscribe()
            }}
          >
            <label htmlFor="newsletter-email" className="sr-only">
              Email address
            </label>
            <input
              id="newsletter-email"
              type="email"
              value={newsletterEmail}
              onChange={(e) => setNewsletterEmail(e.target.value)}
              placeholder="you@example.com"
              className="h-11 min-w-0 flex-1 rounded-xl border border-emerald-800 bg-emerald-950/60 px-4 text-sm text-emerald-50 placeholder:text-emerald-300/50 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50"
            />
            <button
              type="submit"
              disabled={subscribing}
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl bg-emerald-500 px-5 text-sm font-semibold text-emerald-950 transition-all hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:opacity-70"
            >
              {subscribing ? (
                <span className="size-4 animate-spin rounded-full border-2 border-emerald-900/30 border-t-emerald-950" aria-hidden="true" />
              ) : (
                <Send className="size-4" aria-hidden="true" />
              )}
              Subscribe
            </button>
          </form>
        </div>
      </div>
      <div className="mx-auto grid max-w-7xl gap-x-8 gap-y-10 px-4 py-12 sm:grid-cols-2 lg:grid-cols-12 lg:gap-x-10 lg:px-6">
        {/* Brand — spans the full row on small screens so the blurb keeps a readable measure */}
        <div className="flex flex-col gap-4 sm:col-span-2 lg:col-span-4">
          <div className="flex h-9 items-center gap-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600">
              <Pill className="size-5 text-white" aria-hidden="true" />
            </span>
            <span className="text-lg font-bold leading-none">MediPlus</span>
          </div>
          <p className="max-w-sm text-sm leading-relaxed text-emerald-200/90">
            Genuine medicines and health essentials, delivered to your door — fast, safe and
            affordable.
          </p>
          <p className="inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-900 px-3 py-1 text-xs text-emerald-200">
            <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
            Licensed online pharmacy demo
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {[
              { icon: Facebook, label: 'Facebook' },
              { icon: Instagram, label: 'Instagram' },
              { icon: Twitter, label: 'Twitter' },
              { icon: Youtube, label: 'YouTube' },
            ].map(({ icon: Icon, label }) => (
              <a
                key={label}
                href="#"
                onClick={(e) => e.preventDefault()}
                aria-label={`MediPlus on ${label}`}
                title={`MediPlus on ${label}`}
                className="flex size-10 items-center justify-center rounded-full border border-emerald-800 bg-emerald-900/50 text-emerald-200 transition-all hover:-translate-y-0.5 hover:border-emerald-600 hover:bg-emerald-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              >
                <Icon className="size-4" aria-hidden="true" />
              </a>
            ))}
          </div>
        </div>

        {/* Quick links */}
        <div className="lg:col-span-2">
          <h3 className={COLUMN_HEADING}>Quick Links</h3>
          <ul className="mt-4 flex flex-col">
            {visibleLinks.map((l, i) => (
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
                  className={LINK_ROW}
                >
                  {l.label}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Support */}
        <div className="lg:col-span-3">
          <h3 className={COLUMN_HEADING}>Support</h3>
          <div className="mt-4 flex flex-col gap-3">
            {canAccessView(role, 'prescriptions') && (
              <button type="button" onClick={() => setView('prescriptions')} className={LINK_ROW}>
                How prescriptions work
              </button>
            )}
            {/* Contact details are read, not clicked — tighter rhythm than the link rows above */}
            <div className="space-y-1 text-sm">
              <p className="font-medium text-emerald-50">Hotline: 09611-MEDIPLUS</p>
              <p className="text-emerald-200/80">support@medplus.com</p>
              <p className="text-emerald-200/80">Dhaka, Bangladesh</p>
            </div>
          </div>
        </div>

        {/* Payment */}
        <div className="lg:col-span-3">
          <h3 className={COLUMN_HEADING}>Payment</h3>
          <div className="mt-4 flex flex-wrap gap-2">
            {paymentChips.map((p) => (
              <span
                key={p}
                className="rounded-lg border border-emerald-800 bg-emerald-900/60 px-3 py-1.5 text-xs font-medium text-emerald-100"
              >
                {p}
              </span>
            ))}
          </div>
          <p className="mt-4 max-w-xs text-xs leading-relaxed text-emerald-300/80">
            All payments on this demo are simulated. No real money is charged.
          </p>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-emerald-900">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-4 text-center text-xs text-emerald-300/80 sm:flex-row sm:gap-4 sm:text-left lg:px-6">
          <p>
            © {new Date().getFullYear()} MediPlus Pharmacy
            <span aria-hidden="true" className="hidden sm:inline">
              {' · '}
            </span>
            <span className="block sm:inline">Made for demo purposes</span>
          </p>
          <p>
            Built by{' '}
            <a
              href="https://jhossain.vercel.app/"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-sm font-semibold text-emerald-200 underline-offset-4 transition-colors hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-emerald-950"
            >
              Jubair Hossain
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </p>
        </div>
      </div>
    </footer>
  )
}
