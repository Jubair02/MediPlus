'use client'

import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import { useAppStore } from '@/lib/store'
import { canAccessView, fallbackViewFor, isCustomer } from '@/lib/rbac'
import { api, UNAUTHORIZED_EVENT } from '@/lib/api'
import Header from '@/components/store/Header'
import Footer from '@/components/store/Footer'
import HomeView from '@/components/store/HomeView'
import CatalogView from '@/components/store/CatalogView'
import CartView from '@/components/store/CartView'
import WishlistView from '@/components/store/WishlistView'
import CheckoutView from '@/components/store/CheckoutView'
import OrdersView from '@/components/store/OrdersView'
import PrescriptionsView from '@/components/store/PrescriptionsView'
import NotificationsView from '@/components/store/NotificationsView'
import ProfileView from '@/components/store/ProfileView'
import AuthModal from '@/components/store/AuthModal'
import MedicineDetailModal from '@/components/store/MedicineDetailModal'
import BackToTop from '@/components/store/BackToTop'
import Dashboard from '@/components/dashboard/Dashboard'

export default function Page() {
  const hydrated = useAppStore((s) => s.hydrated)
  const view = useAppStore((s) => s.view)
  const user = useAppStore((s) => s.user)
  const setView = useAppStore((s) => s.setView)
  const setCartCount = useAppStore((s) => s.setCartCount)
  const setWishlistIds = useAppStore((s) => s.setWishlistIds)
  const logout = useAppStore((s) => s.logout)
  const setAuthOpen = useAppStore((s) => s.setAuthOpen)

  const role = user?.role ?? null

  // Read the persisted session back. The store defers this (`skipHydration`) so the
  // first client render matches the server's guest markup instead of tripping a
  // hydration mismatch; until it completes, the shell below is what renders.
  useEffect(() => {
    void useAppStore.persist.rehydrate()
  }, [])

  // The API layer clears the token on any 401 and fires this. Tokens last 7 days, so a
  // session can also die from deactivation or a rotated signing secret — without this the
  // app keeps a stale user in the store and every view waits on a request that will never
  // succeed. Drop the session once, say why, and offer the sign-in form.
  useEffect(() => {
    const onUnauthorized = () => {
      if (!useAppStore.getState().user) return
      logout()
      toast.error('Your session has expired. Please sign in again.')
      setAuthOpen(true)
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [logout, setAuthOpen])

  // Refresh cart badge + wishlist on first load when logged in as a customer.
  // Staff accounts have no cart or wishlist — these endpoints 403 for them.
  useEffect(() => {
    if (!isCustomer(user?.role)) return
    api<{ items: unknown[] }>('/api/cart')
      .then((d) => setCartCount(d.items.length))
      .catch(() => {})
    api<{ ids: string[] }>('/api/wishlist')
      .then((d) => setWishlistIds(d.ids))
      .catch(() => {})
  }, [user, setCartCount, setWishlistIds])

  // Scroll to top on view change
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [view])

  // Self-heal: if `view` was forced to something this role may not open, write the
  // permitted view back so the store, the header's active-nav state and the rendered
  // view stay in agreement.
  useEffect(() => {
    if (!canAccessView(role, view)) setView(fallbackViewFor(role))
  }, [role, view, setView])

  // Last line of client-side defence. The store already refuses to set a view this role
  // may not open, but state can be forced (devtools, a stale persisted blob, a role change
  // mid-session) — so resolve what to render against the same policy rather than trusting
  // `view`. Anything not permitted falls back to the role's own landing view.
  const effectiveView = canAccessView(role, view) ? view : fallbackViewFor(role)

  const renderView = () => {
    switch (effectiveView) {
      case 'catalog':
        return <CatalogView />
      case 'cart':
        return <CartView />
      case 'wishlist':
        return <WishlistView />
      case 'checkout':
        return <CheckoutView />
      case 'orders':
        return <OrdersView />
      case 'prescriptions':
        return <PrescriptionsView />
      case 'notifications':
        return <NotificationsView />
      case 'profile':
        return <ProfileView />
      // One dashboard for every staff role. Which sections it offers comes from the
      // registry, keyed on the signed-in role; effectiveView has already gated access.
      case 'admin':
      case 'pharmacist':
      case 'delivery':
        return <Dashboard />
      case 'home':
      default:
        return <HomeView />
    }
  }

  // Pre-hydration shell. Identical on the server and on the first client render, so
  // there is nothing for React to reconcile away — and no flash of the guest home page
  // before the restored session appears.
  if (!hydrated) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <div className="h-16 border-b bg-card" />
        <main className="flex-1">
          <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-8">
            <div className="h-40 animate-pulse rounded-xl bg-muted" />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-48 animate-pulse rounded-xl bg-muted" />
              ))}
            </div>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main className="flex-1">
        <AnimatePresence mode="wait">
          <motion.div
            key={effectiveView}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
          >
            {renderView()}
          </motion.div>
        </AnimatePresence>
      </main>
      <Footer />
      <BackToTop />
      <AuthModal />
      <MedicineDetailModal />
    </div>
  )
}
