'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { AuthUser, Medicine } from '@/lib/types'
import { setToken } from '@/lib/api'

export type View =
  | 'home'
  | 'catalog'
  | 'cart'
  | 'wishlist'
  | 'checkout'
  | 'orders'
  | 'prescriptions'
  | 'notifications'
  | 'profile'
  | 'admin'
  | 'pharmacist'
  | 'delivery'

export interface CatalogFilters {
  search: string
  category: string // category id or slug, '' = all
  minPrice: number | null
  maxPrice: number | null
  rxOnly: boolean
  sort: 'featured' | 'price-asc' | 'price-desc' | 'name-asc' | 'name-desc' | 'newest' | 'rating'
  page: number
}

export const PAGE_SIZE = 12

interface AppState {
  user: AuthUser | null
  view: View
  authOpen: boolean
  cartCount: number
  wishlistIds: string[]
  detailMedicine: Medicine | null
  filters: CatalogFilters
  successOrderNo: string | null

  login: (token: string, user: AuthUser) => void
  logout: () => void
  setUser: (user: AuthUser | null) => void
  setView: (view: View) => void
  setAuthOpen: (open: boolean) => void
  setCartCount: (n: number) => void
  setWishlistIds: (ids: string[]) => void
  toggleWishlistId: (id: string, added: boolean) => void
  setDetailMedicine: (m: Medicine | null) => void
  setFilters: (f: Partial<CatalogFilters>) => void
  resetFilters: () => void
  setSuccessOrderNo: (orderNo: string | null) => void
}

const defaultFilters: CatalogFilters = {
  search: '',
  category: '',
  minPrice: null,
  maxPrice: null,
  rxOnly: false,
  sort: 'featured',
  page: 1,
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      user: null,
      view: 'home',
      authOpen: false,
      cartCount: 0,
      wishlistIds: [],
      detailMedicine: null,
      filters: defaultFilters,
      successOrderNo: null,

      login: (token, user) => {
        setToken(token)
        set({ user, authOpen: false })
      },
      logout: () => {
        setToken(null)
        set({ user: null, view: 'home', cartCount: 0, wishlistIds: [], successOrderNo: null })
      },
      setUser: (user) => set({ user }),
      setView: (view) => set({ view }),
      setAuthOpen: (authOpen) => set({ authOpen }),
      setCartCount: (cartCount) => set({ cartCount }),
      setWishlistIds: (wishlistIds) => set({ wishlistIds }),
      toggleWishlistId: (id, added) =>
        set((s) => ({
          wishlistIds: added ? [...s.wishlistIds, id] : s.wishlistIds.filter((w) => w !== id),
        })),
      setDetailMedicine: (detailMedicine) => set({ detailMedicine }),
      setFilters: (f) => set((s) => ({ filters: { ...s.filters, ...f } })),
      resetFilters: () => set({ filters: defaultFilters }),
      setSuccessOrderNo: (successOrderNo) => set({ successOrderNo }),
    }),
    {
      name: 'medplus-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ user: state.user }) as AppState,
    }
  )
)
