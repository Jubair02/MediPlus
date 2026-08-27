'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRight,
  Bell,
  FileText,
  Heart,
  Home,
  LayoutDashboard,
  LogIn,
  LogOut,
  Menu,
  Moon,
  Package,
  Pill,
  Search,
  SearchX,
  ShoppingCart,
  Star,
  Sun,
  UserRound,
} from 'lucide-react'
import { api } from '@/lib/api'
import { useAppStore, type View } from '@/lib/store'
import { effectivePrice, fmtBDT, fmtDateTime } from '@/lib/format'
import type { AuthUser, Medicine, NotificationItem, Role } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { MedImage } from '@/components/store/MedicineCard'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

const ROLE_DASHBOARD: Partial<Record<Role, View>> = {
  ADMIN: 'admin',
  PHARMACIST: 'pharmacist',
  DELIVERY: 'delivery',
}

const NAV_ITEMS: { view: View; label: string; icon: typeof Home; authOnly?: boolean }[] = [
  { view: 'home', label: 'Home', icon: Home },
  { view: 'catalog', label: 'Medicines', icon: Pill },
  { view: 'wishlist', label: 'Wishlist', icon: Heart, authOnly: true },
  { view: 'orders', label: 'My Orders', icon: Package, authOnly: true },
  { view: 'prescriptions', label: 'Prescriptions', icon: FileText, authOnly: true },
]

function ThemeToggle() {
  const { setTheme, resolvedTheme } = useTheme()
  return (
    <Button
      variant="ghost"
      size="icon"
      className="hidden size-11 sm:inline-flex"
      aria-label="Toggle dark mode"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
    >
      {/* CSS-driven swap avoids hydration mismatch — .dark class lives on <html> */}
      <Moon className="size-5 dark:hidden" aria-hidden="true" />
      <Sun className="hidden size-5 dark:block" aria-hidden="true" />
    </Button>
  )
}

function NavLinks({
  user,
  view,
  go,
  stacked = false,
}: {
  user: AuthUser | null
  view: View
  go: (v: View) => void
  stacked?: boolean
}) {
  return (
    <>
      {NAV_ITEMS.filter((n) => !n.authOnly || user).map((n) => (
        <button
          key={n.view}
          type="button"
          onClick={() => go(n.view)}
          className={cn(
            'flex min-h-11 items-center whitespace-nowrap rounded-md text-sm transition-colors hover:text-primary',
            stacked ? 'w-full gap-2 px-3 text-left' : 'px-3 py-2',
            view === n.view ? 'font-semibold text-primary' : 'text-muted-foreground'
          )}
        >
          {stacked && <n.icon className="size-4" aria-hidden="true" />}
          {n.label}
        </button>
      ))}
    </>
  )
}

/** Case-insensitive <mark> highlight of the query inside a medicine name. */
function highlightName(name: string, query: string) {
  const q = query.trim()
  if (!q) return name
  const idx = name.toLowerCase().indexOf(q.toLowerCase())
  if (idx < 0) return name
  return (
    <>
      {name.slice(0, idx)}
      <mark className="rounded-sm bg-primary/20 px-0.5 text-foreground">
        {name.slice(idx, idx + q.length)}
      </mark>
      {name.slice(idx + q.length)}
    </>
  )
}

function SearchForm({
  search,
  onSearchChange,
  onSubmit,
  onAction,
}: {
  search: string
  onSearchChange: (v: string) => void
  onSubmit: (e: React.FormEvent) => void
  /** Called after an option is picked or "view all" — closes the mobile Sheet. */
  onAction?: () => void
}) {
  const setFilters = useAppStore((s) => s.setFilters)
  const setView = useAppStore((s) => s.setView)
  const setDetailMedicine = useAppStore((s) => s.setDetailMedicine)

  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<Medicine[]>([])
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(-1)

  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const acRef = useRef<AbortController | null>(null)
  const listId = useId()
  const optId = (i: number) => `${listId}-opt-${i}`

  const showPanel = open && focused

  const closeDropdown = useCallback(() => {
    setOpen(false)
    setActive(-1)
    setLoading(false)
    acRef.current?.abort()
    acRef.current = null
  }, [])

  // Debounced suggestion fetch (250ms), re-run on focus so re-selecting the
  // input re-shows suggestions. All state updates happen asynchronously
  // inside the timer/promise callbacks — never synchronously in the effect body.
  useEffect(() => {
    const q = search.trim()
    const ac = new AbortController()
    acRef.current = ac
    const t = setTimeout(() => {
      if (ac.signal.aborted) return
      if (q.length < 2) {
        setResults([])
        setQuery('')
        setActive(-1)
        setOpen(false)
        setLoading(false)
        return
      }
      setLoading(true)
      api<{ medicines: Medicine[] }>(
        `/api/medicines?search=${encodeURIComponent(q)}&limit=6`,
        { signal: ac.signal }
      )
        .then((d) => {
          if (ac.signal.aborted) return // ignore stale responses
          setResults(d.medicines)
          setQuery(q)
          setActive(-1)
          setLoading(false)
          setOpen(true)
        })
        .catch(() => {
          if (ac.signal.aborted) return
          // Network/server error → fail silently, no toast spam
          setResults([])
          setQuery('')
          setOpen(false)
          setLoading(false)
        })
    }, 250)
    return () => {
      clearTimeout(t)
      ac.abort() // cancel on unmount / next keystroke / close
      if (acRef.current === ac) acRef.current = null
    }
  }, [search, focused])

  // Close when clicking outside the search wrapper
  useEffect(() => {
    if (!showPanel) return
    const onDocMouseDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) closeDropdown()
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [showPanel, closeDropdown])

  // Escape while the panel is open must close ONLY the panel. Radix layers
  // (mobile Sheet) listen on document in the CAPTURE phase, so a bubble-phase
  // React handler is too late — intercept on window capture instead and stop
  // the event before any Radix dismiss logic runs.
  useEffect(() => {
    if (!showPanel) return
    const onCaptureKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeDropdown()
      }
    }
    window.addEventListener('keydown', onCaptureKey, true)
    return () => window.removeEventListener('keydown', onCaptureKey, true)
  }, [showPanel, closeDropdown])

  const pickOption = (m: Medicine) => {
    setDetailMedicine(m) // opens the product modal — no catalog navigation
    closeDropdown()
    onAction?.()
  }

  const viewAll = () => {
    setFilters({ search: query, page: 1 })
    setView('catalog')
    closeDropdown()
    onAction?.()
  }

  const handleSubmit = (e: React.FormEvent) => {
    closeDropdown()
    onSubmit(e) // existing catalog-search behavior
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      // Panel-open Escape is handled by the window capture listener above;
      // reaching here means the panel is already closed → blur (second Escape).
      inputRef.current?.blur()
      return
    }
    if (!showPanel || results.length === 0) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const n = results.length
      setActive((i) =>
        i < 0
          ? e.key === 'ArrowDown'
            ? 0
            : n - 1
          : e.key === 'ArrowDown'
            ? (i + 1) % n
            : (i - 1 + n) % n
      )
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActive(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setActive(results.length - 1)
    } else if (e.key === 'Enter' && active >= 0 && active < results.length) {
      e.preventDefault() // open the ACTIVE option; plain Enter still submits the form
      pickOption(results[active])
    }
  }

  return (
    <div ref={wrapRef} className="relative w-full">
      <form onSubmit={handleSubmit} role="search" className="flex w-full items-center gap-2">
        <Input
          ref={inputRef}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={handleKeyDown}
          placeholder="Search medicines, brands…"
          aria-label="Search medicines"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-activedescendant={showPanel && active >= 0 ? optId(active) : undefined}
          autoComplete="off"
          className="h-11 flex-1 rounded-xl"
        />
        <Button type="submit" size="icon" aria-label="Search" className="size-11 shrink-0 rounded-xl">
          <Search className="size-4" aria-hidden="true" />
        </Button>
      </form>

      <AnimatePresence>
        {showPanel && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.13, ease: 'easeOut' }}
            onMouseDown={(e) => e.preventDefault() /* keep input focus on option click */}
            className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-xl border bg-card shadow-lg"
          >
            {loading ? (
              <div className="space-y-1 p-2" aria-hidden="true">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2.5 px-2 py-1.5">
                    <Skeleton className="size-10 shrink-0 rounded-md" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3.5 w-3/5" />
                      <Skeleton className="h-3 w-2/5" />
                    </div>
                  </div>
                ))}
              </div>
            ) : results.length === 0 ? (
              <div className="flex flex-col items-center gap-1.5 px-4 py-6 text-center">
                <SearchX className="size-5 text-muted-foreground/70" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">
                  No matches for{' '}
                  <span className="font-medium text-foreground">&ldquo;{query}&rdquo;</span> — try
                  another spelling
                </p>
              </div>
            ) : (
              <>
                <div
                  id={listId}
                  role="listbox"
                  aria-label="Search suggestions"
                  className="max-h-80 overflow-y-auto p-1.5 scrollbar-thin"
                >
                  {results.map((m, i) => (
                    <motion.button
                      key={m.id}
                      type="button"
                      role="option"
                      id={optId(i)}
                      aria-selected={i === active}
                      whileTap={{ scale: 0.99 }}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pickOption(m)}
                      className={cn(
                        'flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-primary/5',
                        i === active && 'bg-primary/5'
                      )}
                    >
                      <MedImage src={m.image} alt="" className="size-10 shrink-0 rounded-md" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium leading-tight">
                          {highlightName(m.name, query)}
                        </p>
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                          {(m.brand || m.genericName) && (
                            <span className="min-w-0 truncate">{m.brand || m.genericName}</span>
                          )}
                          <span className="shrink-0 font-semibold text-primary">
                            {fmtBDT(effectivePrice(m))}
                          </span>
                          {(m.ratingCount ?? 0) > 0 && m.rating != null && (
                            <span className="flex shrink-0 items-center gap-0.5 text-amber-500 dark:text-amber-400">
                              <Star
                                className="size-3 fill-amber-400 text-amber-400"
                                aria-hidden="true"
                              />
                              {m.rating.toFixed(1)}
                            </span>
                          )}
                          {m.requiresPrescription && (
                            <span className="shrink-0 rounded bg-red-500/10 px-1 py-px text-[10px] font-bold text-red-600 dark:text-red-400">
                              Rx
                            </span>
                          )}
                        </div>
                      </div>
                    </motion.button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={viewAll}
                  className="flex min-h-11 w-full items-center justify-center gap-1.5 border-t text-xs text-muted-foreground transition-colors hover:bg-primary/5 hover:text-primary"
                >
                  View all results for &ldquo;{query}&rdquo;
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function Header() {
  const user = useAppStore((s) => s.user)
  const view = useAppStore((s) => s.view)
  const cartCount = useAppStore((s) => s.cartCount)
  const wishlistCount = useAppStore((s) => s.wishlistIds.length)
  const filters = useAppStore((s) => s.filters)
  const setView = useAppStore((s) => s.setView)
  const setFilters = useAppStore((s) => s.setFilters)
  const setAuthOpen = useAppStore((s) => s.setAuthOpen)
  const logout = useAppStore((s) => s.logout)

  const [search, setSearch] = useState(filters.search)
  const [syncedSearch, setSyncedSearch] = useState(filters.search)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [unread, setUnread] = useState(0)

  // Keep the header search box in sync when filters change elsewhere
  // (state-adjust-during-render pattern — no effect needed)
  if (filters.search !== syncedSearch) {
    setSyncedSearch(filters.search)
    setSearch(filters.search)
  }

  const dashboardView = user ? ROLE_DASHBOARD[user.role] : undefined

  const go = (v: View) => {
    setView(v)
    setMobileOpen(false)
  }

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setFilters({ search, page: 1 })
    setView('catalog')
    setMobileOpen(false)
  }

  const markAllRead = () => {
    api<{ ok: boolean }>('/api/notifications', { method: 'PUT', body: { action: 'read-all' } })
      .then(() => {
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
        setUnread(0)
      })
      .catch(() => {})
  }

  // Fetch notifications each time the popover opens
  useEffect(() => {
    if (!notifOpen || !user) return
    const ac = new AbortController()
    api<{ notifications: NotificationItem[]; unread: number }>('/api/notifications', { signal: ac.signal })
      .then((d) => {
        setNotifications(d.notifications)
        setUnread(d.unread)
      })
      .catch(() => {})
    return () => ac.abort()
  }, [notifOpen, user])

  // Sync the bell badge when the full-page notifications view marks everything read
  useEffect(() => {
    const onReadAll = () => {
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
      setUnread(0)
    }
    window.addEventListener('medplus:notifications-read', onReadAll)
    return () => window.removeEventListener('medplus:notifications-read', onReadAll)
  }, [])

  return (
    <header className="sticky top-0 z-40 border-b bg-card/90 backdrop-blur">
      {/* Announcement bar */}
      <div className="hidden bg-emerald-600 py-1.5 text-center text-xs font-medium text-white sm:block">
        Free delivery on orders over {fmtBDT(2000)} · Use code SAVE10 for 10% off
      </div>

      {/* Main row */}
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-3 sm:gap-3 sm:px-4 lg:px-6">
        {/* Mobile menu */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
              <Menu className="size-5" aria-hidden="true" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-80">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-lg bg-primary">
                  <Pill className="size-5 text-primary-foreground" aria-hidden="true" />
                </span>
                MediPlus
              </SheetTitle>
              <SheetDescription>Your online pharmacy</SheetDescription>
            </SheetHeader>
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-6 scrollbar-thin">
              <SearchForm
                search={search}
                onSearchChange={setSearch}
                onSubmit={submitSearch}
                onAction={() => setMobileOpen(false)}
              />
              <Separator />
              <nav className="flex flex-col gap-1" aria-label="Mobile navigation">
                <NavLinks user={user} view={view} go={go} stacked />
                {dashboardView && (
                  <button
                    type="button"
                    onClick={() => go(dashboardView)}
                    className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left text-sm text-muted-foreground transition-colors hover:text-primary"
                  >
                    <LayoutDashboard className="size-4" aria-hidden="true" />
                    {user?.role === 'ADMIN'
                      ? 'Admin dashboard'
                      : user?.role === 'PHARMACIST'
                        ? 'Pharmacist dashboard'
                        : 'Delivery dashboard'}
                  </button>
                )}
              </nav>
              <Separator />
              {/* Theme toggle lives here on small screens to keep the header row overflow-free */}
              <div className="flex items-center justify-between rounded-lg border px-3 py-1.5">
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Moon className="size-4 dark:hidden" aria-hidden="true" />
                  <Sun className="hidden size-4 dark:block" aria-hidden="true" />
                  Dark mode
                </span>
                <ThemeToggle />
              </div>
              <Separator />
              {user ? (
                <Button
                  variant="outline"
                  className="min-h-11 justify-start gap-2 text-red-600 hover:bg-red-50 hover:text-red-600"
                  onClick={() => {
                    logout()
                    setMobileOpen(false)
                  }}
                >
                  <LogOut className="size-4" aria-hidden="true" />
                  Log out
                </Button>
              ) : (
                <Button
                  className="min-h-11"
                  onClick={() => {
                    setAuthOpen(true)
                    setMobileOpen(false)
                  }}
                >
                  <LogIn className="size-4" aria-hidden="true" />
                  Sign in
                </Button>
              )}
            </div>
          </SheetContent>
        </Sheet>

        {/* Logo */}
        <button
          type="button"
          onClick={() => setView('home')}
          className="flex min-h-11 items-center gap-2 rounded-lg px-1"
          aria-label="MediPlus home"
        >
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary shadow-sm">
            <Pill className="size-5 text-primary-foreground" aria-hidden="true" />
          </span>
          <span className="text-lg font-bold tracking-tight">MediPlus</span>
        </button>

        {/* Desktop nav */}
        <nav className="hidden items-center md:flex" aria-label="Main navigation">
          <NavLinks user={user} view={view} go={go} />
        </nav>

        {/* Search (desktop) */}
        <div className="ml-auto hidden w-64 md:block xl:w-80">
          <SearchForm search={search} onSearchChange={setSearch} onSubmit={submitSearch} />
        </div>

        {/* Right actions */}
        <div className="ml-auto flex items-center gap-1 sm:gap-2 md:ml-2">
          {/* Theme toggle */}
          <ThemeToggle />

          {/* Wishlist (icon-only, logged in only) */}
          {user && (
            <Button
              variant="ghost"
              size="icon"
              className="relative size-11"
              onClick={() => setView('wishlist')}
              aria-label={`Wishlist, ${wishlistCount} saved`}
            >
              <Heart
                className={cn('size-5', wishlistCount > 0 && 'fill-red-500 text-red-500')}
                aria-hidden="true"
              />
              {wishlistCount > 0 && (
                <span className="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                  {wishlistCount > 9 ? '9+' : wishlistCount}
                </span>
              )}
            </Button>
          )}

          {/* Cart */}
          <Button
            variant="outline"
            className="relative h-11 gap-2 rounded-xl"
            onClick={() => setView('cart')}
            aria-label={`Cart, ${cartCount} items`}
          >
            <ShoppingCart className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Cart</span>
            {cartCount > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                {cartCount > 9 ? '9+' : cartCount}
              </span>
            )}
          </Button>

          {/* Notifications (logged in only) */}
          {user && (
            <Popover open={notifOpen} onOpenChange={setNotifOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="relative size-11"
                  aria-label={`Notifications, ${unread} unread`}
                >
                  <Bell className="size-5" aria-hidden="true" />
                  {unread > 0 && (
                    <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                      {unread > 9 ? '9+' : unread}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-0">
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <p className="text-sm font-semibold">Notifications</p>
                  {unread > 0 && (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      onClick={markAllRead}
                    >
                      Mark all read
                    </Button>
                  )}
                </div>
                <div className="max-h-96 overflow-y-auto scrollbar-thin">
                  {notifications.length === 0 ? (
                    <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                      No notifications yet
                    </p>
                  ) : (
                    notifications.map((n) => (
                      <div
                        key={n.id}
                        className={cn(
                          'flex gap-3 border-b px-4 py-3 text-sm last:border-b-0',
                          !n.read && 'bg-accent/50'
                        )}
                      >
                        <span
                          className={cn(
                            'mt-1.5 size-2 shrink-0 rounded-full',
                            n.read ? 'bg-border' : 'bg-emerald-500'
                          )}
                          aria-hidden="true"
                        />
                        <div className="min-w-0">
                          <p className="font-medium leading-snug">{n.title}</p>
                          <p className="text-xs text-muted-foreground">{n.message}</p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                            {fmtDateTime(n.createdAt)}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <div className="border-t p-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 w-full gap-1.5"
                    onClick={() => {
                      setNotifOpen(false)
                      setView('notifications')
                    }}
                  >
                    <Bell className="size-4" aria-hidden="true" />
                    View all notifications
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          )}

          {/* User area */}
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex min-h-11 items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Account menu"
                >
                  <Avatar className="size-9 border">
                    <AvatarFallback className="bg-primary/10 font-semibold text-primary">
                      {(user.name?.[0] ?? user.email[0] ?? 'U').toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <p className="truncate text-sm font-semibold">{user.name ?? user.email}</p>
                  <p className="truncate text-xs font-normal text-muted-foreground">{user.email}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {dashboardView && (
                  <DropdownMenuItem onClick={() => setView(dashboardView)}>
                    <LayoutDashboard className="size-4" aria-hidden="true" />
                    {user.role === 'ADMIN'
                      ? 'Admin dashboard'
                      : user.role === 'PHARMACIST'
                        ? 'Pharmacist dashboard'
                        : 'Delivery dashboard'}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => setView('wishlist')}>
                  <Heart className="size-4" aria-hidden="true" />
                  My Wishlist
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setView('orders')}>
                  <Package className="size-4" aria-hidden="true" />
                  My Orders
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setView('prescriptions')}>
                  <FileText className="size-4" aria-hidden="true" />
                  My Prescriptions
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setView('profile')}>
                  <UserRound className="size-4" aria-hidden="true" />
                  Profile
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-red-600 focus:bg-red-50 focus:text-red-600"
                  onClick={() => logout()}
                >
                  <LogOut className="size-4" aria-hidden="true" />
                  Log Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button className="h-11 rounded-xl" onClick={() => setAuthOpen(true)}>
              <LogIn className="size-4" aria-hidden="true" />
              Sign in
            </Button>
          )}
        </div>
      </div>

      {/* Small screens: compact secondary strip (active view hint) */}
      {view !== 'home' && (
        <div className="flex items-center justify-center border-t bg-background/60 py-1 md:hidden">
          <Badge variant="secondary" className="rounded-full text-[11px] font-normal">
            {NAV_ITEMS.find((n) => n.view === view)?.label ?? view}
          </Badge>
        </div>
      )}
    </header>
  )
}
