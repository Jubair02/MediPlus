'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { AuthUser, Medicine } from '@/lib/types'
import { setToken } from '@/lib/api'
import { canAccessView, fallbackViewFor, landingViewFor, type View } from '@/lib/rbac'

// View/role policy lives in @/lib/rbac so the API routes enforce the identical rules.
// Re-exported here because components already import `type View` from the store.
export type { View }
export { landingViewFor }

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
        const landing = landingViewFor(user.role)
        set({ user, authOpen: false, ...(landing ? { view: landing } : {}) })
      },
      logout: () => {
        setToken(null)
        set({ user: null, view: 'home', cartCount: 0, wishlistIds: [], successOrderNo: null })
      },
      setUser: (user) =>
        set((s) => ({
          user,
          // A refreshed profile can carry a changed role — drop the view if it no longer applies.
          view: canAccessView(user?.role ?? null, s.view) ? s.view : fallbackViewFor(user?.role ?? null),
        })),
      // Central client-side route guard: every view change in the app funnels through
      // here, so a view the current role may not open is redirected to that role's
      // dashboard instead. The API enforces the same policy independently.
      setView: (view) =>
        set((s) => ({
          view: canAccessView(s.user?.role ?? null, view) ? view : fallbackViewFor(s.user?.role ?? null),
        })),
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
      partialize: (state) => ({ user: state.user, view: state.view }) as AppState,
      // A restored view must still be one this user may open — role can change, or the
      // session can end, between the write and the next page load. This covers the
      // customer views as well: a staff account must not rehydrate into the storefront.
      onRehydrateStorage: () => (state) => {
        if (!state) return
        if (!canAccessView(state.user?.role ?? null, state.view)) {
          state.view = fallbackViewFor(state.user?.role ?? null)
        }
      },
    }
  )
)
