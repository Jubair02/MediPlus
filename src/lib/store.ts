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
  /**
   * Whether the persisted slice has been read back from localStorage yet.
   *
   * Server rendering cannot see localStorage, so the server always emits the guest
   * view. `persist` used to hydrate synchronously at module load, which made the very
   * first client render the *restored* view — a different tree than the server sent, so
   * React threw a hydration mismatch, discarded the markup and re-rendered, which the
   * user saw as a flash of the guest home page on every return visit. Hydration is now
   * deferred (`skipHydration`) and kicked off from an effect, and this flag lets the app
   * render a neutral shell until the real state has landed. See src/app/page.tsx.
   */
  hydrated: boolean
  user: AuthUser | null
  view: View
  authOpen: boolean
  cartCount: number
  wishlistIds: string[]
  detailMedicine: Medicine | null
  filters: CatalogFilters
  successOrderNo: string | null
  /** Desktop: dashboard sidebar shown as a narrow icon rail. Remembered between visits. */
  sidebarCollapsed: boolean
  /** Mobile: dashboard sidebar drawer is open. Deliberately not persisted — it must
   *  never restore open on a fresh load. */
  sidebarOpen: boolean

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
  toggleSidebarCollapsed: () => void
  setSidebarOpen: (open: boolean) => void
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
      hydrated: false,
      user: null,
      view: 'home',
      authOpen: false,
      cartCount: 0,
      wishlistIds: [],
      detailMedicine: null,
      filters: defaultFilters,
      successOrderNo: null,
      sidebarCollapsed: false,
      sidebarOpen: false,

      login: (token, user) => {
        setToken(token)
        const landing = landingViewFor(user.role)
        set({ user, authOpen: false, ...(landing ? { view: landing } : {}) })
      },
      logout: () => {
        setToken(null)
        set({ user: null, view: 'home', cartCount: 0, wishlistIds: [], successOrderNo: null, sidebarOpen: false })
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
          sidebarOpen: false,
        })),
      setAuthOpen: (authOpen) => set({ authOpen }),
      setCartCount: (cartCount) => set({ cartCount }),
      // Server responses are authoritative; de-dupe so a stale id can never be counted twice
      // (the header badge is `wishlistIds.length`).
      setWishlistIds: (wishlistIds) => set({ wishlistIds: [...new Set(wishlistIds)] }),
      // Idempotent: adding an id that is already present is a no-op rather than a duplicate.
      toggleWishlistId: (id, added) =>
        set((s) => ({
          wishlistIds: added
            ? s.wishlistIds.includes(id)
              ? s.wishlistIds
              : [...s.wishlistIds, id]
            : s.wishlistIds.filter((w) => w !== id),
        })),
      setDetailMedicine: (detailMedicine) => set({ detailMedicine }),
      setFilters: (f) => set((s) => ({ filters: { ...s.filters, ...f } })),
      resetFilters: () => set({ filters: defaultFilters }),
      setSuccessOrderNo: (successOrderNo) => set({ successOrderNo }),
      toggleSidebarCollapsed: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
    }),
    {
      name: 'medplus-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) =>
        ({ user: state.user, view: state.view, sidebarCollapsed: state.sidebarCollapsed }) as AppState,
      // Deferred hydration: nothing is read from localStorage until something calls
      // `useAppStore.persist.rehydrate()`, which src/app/page.tsx does from a mount
      // effect. That keeps the first client render identical to the server's.
      skipHydration: true,
      // The view-policy fix belongs in `merge`, not in onRehydrateStorage: merge runs
      // before persist's `set()`, so its result reaches React through the normal
      // notification. The onRehydrateStorage callback is handed the live state object
      // and mutating it there notifies nobody — invisible while hydration was
      // synchronous (no render had happened yet), a dropped update now that it is not.
      //
      // A restored view must still be one this user may open — role can change, or the
      // session can end, between the write and the next page load. This covers the
      // customer views as well: a staff account must not rehydrate into the storefront.
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as Partial<AppState> | undefined) }
        const role = merged.user?.role ?? null
        return {
          ...merged,
          hydrated: true,
          view: canAccessView(role, merged.view) ? merged.view : fallbackViewFor(role),
          // partialize does not write this, but merge spreads whatever is actually in
          // storage — a stale or hand-edited blob would otherwise restore the mobile
          // drawer open, covering the page on first paint.
          sidebarOpen: false,
        }
      },
      onRehydrateStorage: () => (_state, error) => {
        // merge() flips `hydrated` on the happy path. This is the failure path only —
        // a private-mode localStorage that throws, or a corrupt blob — where merge is
        // never reached and the app would otherwise sit on the loading shell forever.
        if (error) useAppStore.setState({ hydrated: true })
      },
    }
  )
)
