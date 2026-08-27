'use client'

import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useAppStore } from '@/lib/store'
import { api } from '@/lib/api'
import Header from '@/components/store/Header'
import Footer from '@/components/store/Footer'
import HomeView from '@/components/store/HomeView'
import CatalogView from '@/components/store/CatalogView'
import CartView from '@/components/store/CartView'
import WishlistView from '@/components/store/WishlistView'
import CheckoutView from '@/components/store/CheckoutView'
import OrdersView from '@/components/store/OrdersView'
import PrescriptionsView from '@/components/store/PrescriptionsView'
import ProfileView from '@/components/store/ProfileView'
import AuthModal from '@/components/store/AuthModal'
import MedicineDetailModal from '@/components/store/MedicineDetailModal'
import AdminDashboard from '@/components/admin/AdminDashboard'
import PharmacistDashboard from '@/components/pharmacist/PharmacistDashboard'
import DeliveryDashboard from '@/components/delivery/DeliveryDashboard'

export default function Page() {
  const view = useAppStore((s) => s.view)
  const user = useAppStore((s) => s.user)
  const setCartCount = useAppStore((s) => s.setCartCount)
  const setWishlistIds = useAppStore((s) => s.setWishlistIds)

  // Refresh cart badge + wishlist on first load when logged in
  useEffect(() => {
    if (!user) return
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

  const renderView = () => {
    switch (view) {
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
      case 'profile':
        return <ProfileView />
      case 'admin':
        return user?.role === 'ADMIN' ? <AdminDashboard /> : <HomeView />
      case 'pharmacist':
        return user?.role === 'PHARMACIST' ? <PharmacistDashboard /> : <HomeView />
      case 'delivery':
        return user?.role === 'DELIVERY' ? <DeliveryDashboard /> : <HomeView />
      case 'home':
      default:
        return <HomeView />
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main className="flex-1">
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
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
      <AuthModal />
      <MedicineDetailModal />
    </div>
  )
}
