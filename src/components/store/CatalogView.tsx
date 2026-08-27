'use client'

import { useEffect, useState } from 'react'
import { SearchX, SlidersHorizontal, X } from 'lucide-react'
import { api } from '@/lib/api'
import { PAGE_SIZE, useAppStore, type CatalogFilters } from '@/lib/store'
import type { Category, Medicine } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import MedicineCard from '@/components/store/MedicineCard'
import { cn } from '@/lib/utils'

const SORT_OPTIONS: { value: CatalogFilters['sort']; label: string }[] = [
  { value: 'featured', label: 'Featured' },
  { value: 'price-asc', label: 'Price: Low to High' },
  { value: 'price-desc', label: 'Price: High to Low' },
  { value: 'name-asc', label: 'Name A–Z' },
  { value: 'name-desc', label: 'Name Z–A' },
  { value: 'newest', label: 'Newest' },
]

interface MedicinePage {
  medicines: Medicine[]
  total: number
  page: number
  pages: number
}

type MedicinePageState = MedicinePage & { key: string }

export default function CatalogView() {
  const filters = useAppStore((s) => s.filters)
  const setFilters = useAppStore((s) => s.setFilters)
  const resetFilters = useAppStore((s) => s.resetFilters)
  const setDetailMedicine = useAppStore((s) => s.setDetailMedicine)

  const [categories, setCategories] = useState<Category[]>([])
  const [data, setData] = useState<MedicinePageState | null>(null)
  const [minInput, setMinInput] = useState(filters.minPrice?.toString() ?? '')
  const [maxInput, setMaxInput] = useState(filters.maxPrice?.toString() ?? '')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)

  // Categories never change while the view is open — load once
  useEffect(() => {
    const ac = new AbortController()
    api<{ categories: Category[] }>('/api/categories', { signal: ac.signal })
      .then((d) => setCategories(d.categories))
      .catch(() => {})
    return () => ac.abort()
  }, [])

  // Fetch medicines whenever filters change. `loading` is DERIVED from the
  // filter key so the skeleton shows instantly on any filter change without
  // synchronously calling setState inside the effect.
  const filterKey = JSON.stringify(filters)
  const loading =
    data === null ? errorKey !== filterKey : data.key !== filterKey && errorKey !== filterKey
  useEffect(() => {
    const ac = new AbortController()
    const f = useAppStore.getState().filters
    const params = new URLSearchParams()
    if (f.search) params.set('search', f.search)
    if (f.category) params.set('category', f.category)
    if (f.minPrice != null) params.set('minPrice', String(f.minPrice))
    if (f.maxPrice != null) params.set('maxPrice', String(f.maxPrice))
    if (f.rxOnly) params.set('rxOnly', 'true')
    params.set('sort', f.sort)
    params.set('page', String(f.page))
    params.set('limit', String(PAGE_SIZE))

    api<MedicinePage>(`/api/medicines?${params.toString()}`, { signal: ac.signal })
      .then((d) => {
        if (ac.signal.aborted) return
        setData({ ...d, key: filterKey })
        setErrorKey(null)
        // Re-clamp if the server trimmed the page range
        if (d.page !== f.page && d.pages > 0) setFilters({ page: d.page })
      })
      .catch(() => {
        if (!ac.signal.aborted) setErrorKey(filterKey)
      })
    return () => ac.abort()
  }, [filterKey, reloadNonce, setFilters])

  const applyPrice = () => {
    const min = minInput.trim() === '' ? null : Number(minInput)
    const max = maxInput.trim() === '' ? null : Number(maxInput)
    const bad = (v: number | null) => v != null && (!Number.isFinite(v) || v < 0)
    if (bad(min) || bad(max)) return
    setFilters({ minPrice: min, maxPrice: max, page: 1 })
    setSheetOpen(false)
  }

  const clearAll = () => {
    resetFilters()
    setMinInput('')
    setMaxInput('')
  }

  const filterControls = (
    <div className="space-y-6">
      {/* Categories */}
      <div>
        <p className="mb-2 text-sm font-semibold">Categories</p>
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => setFilters({ category: '', page: 1 })}
            className={cn(
              'flex min-h-11 items-center justify-between rounded-lg border px-3 text-sm transition-colors',
              filters.category === ''
                ? 'border-primary bg-primary/10 font-semibold text-primary'
                : 'border-transparent text-muted-foreground hover:bg-accent'
            )}
          >
            All categories
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setFilters({ category: c.id, page: 1 })
                setSheetOpen(false)
              }}
              className={cn(
                'flex min-h-11 items-center justify-between rounded-lg border px-3 text-sm transition-colors',
                filters.category === c.id
                  ? 'border-primary bg-primary/10 font-semibold text-primary'
                  : 'border-transparent text-muted-foreground hover:bg-accent'
              )}
            >
              <span className="truncate">{c.name}</span>
              <span className="text-xs opacity-70">{c.medicineCount ?? ''}</span>
            </button>
          ))}
        </div>
      </div>

      <Separator />

      {/* Price range */}
      <div>
        <p className="mb-2 text-sm font-semibold">Price range</p>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={0}
            inputMode="numeric"
            placeholder="Min"
            aria-label="Minimum price"
            value={minInput}
            onChange={(e) => setMinInput(e.target.value)}
            className="h-11"
          />
          <span className="text-muted-foreground">–</span>
          <Input
            type="number"
            min={0}
            inputMode="numeric"
            placeholder="Max"
            aria-label="Maximum price"
            value={maxInput}
            onChange={(e) => setMaxInput(e.target.value)}
            className="h-11"
          />
        </div>
        <Button className="mt-2 h-11 w-full rounded-xl" variant="outline" onClick={applyPrice}>
          Apply price
        </Button>
      </div>

      <Separator />

      {/* Rx only */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label htmlFor="rx-only" className="text-sm font-semibold">
            Prescription only
          </Label>
          <p className="text-xs text-muted-foreground">Show Rx medicines only</p>
        </div>
        <Switch
          id="rx-only"
          checked={filters.rxOnly}
          onCheckedChange={(v) => setFilters({ rxOnly: v === true, page: 1 })}
        />
      </div>

      <Separator />

      <Button
        variant="ghost"
        className="h-11 w-full text-red-600 hover:bg-red-50 hover:text-red-600"
        onClick={clearAll}
      >
        Clear all filters
      </Button>
    </div>
  )

  const total = data?.total ?? 0
  const pages = Math.max(1, data?.pages ?? 1)

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 pt-6 lg:px-6">
      <div className="flex gap-8">
        {/* Sidebar (desktop) */}
        <aside className="hidden w-64 shrink-0 lg:block">
          <div className="sticky top-28 max-h-[calc(100vh-8rem)] overflow-y-auto rounded-xl border bg-card p-4 scrollbar-thin">
            {filterControls}
          </div>
        </aside>

        {/* Main column */}
        <div className="min-w-0 flex-1">
          {/* Toolbar */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {/* Mobile filters */}
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" className="h-11 gap-2 rounded-xl lg:hidden">
                  <SlidersHorizontal className="size-4" aria-hidden="true" />
                  Filters
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-80 overflow-y-auto scrollbar-thin">
                <SheetHeader>
                  <SheetTitle>Filters</SheetTitle>
                </SheetHeader>
                <div className="px-4 pb-6">{filterControls}</div>
              </SheetContent>
            </Sheet>

            <p className="text-sm text-muted-foreground" aria-live="polite">
              {loading ? 'Loading…' : `${total} ${total === 1 ? 'medicine' : 'medicines'} found`}
            </p>

            <div className="ml-auto flex items-center gap-2">
              <Label htmlFor="sort" className="hidden text-sm text-muted-foreground sm:block">
                Sort by
              </Label>
              <Select
                value={filters.sort}
                onValueChange={(v) => setFilters({ sort: v as CatalogFilters['sort'], page: 1 })}
              >
                <SelectTrigger id="sort" className="h-11 w-44 rounded-xl">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Active search chip */}
          {filters.search && (
            <div className="mb-4">
              <span className="inline-flex items-center gap-1.5 rounded-full border bg-accent px-3 py-1.5 text-sm">
                Search: <span className="font-medium">{filters.search}</span>
                <button
                  type="button"
                  aria-label="Clear search"
                  className="flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
                  onClick={() => setFilters({ search: '', page: 1 })}
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </span>
            </div>
          )}

          {/* Grid */}
          {loading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:gap-4">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="aspect-square rounded-xl" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              ))}
            </div>
          ) : !data || errorKey === filterKey ? (
            <Card className="items-center gap-3 p-10 text-center shadow-sm">
              <span className="flex size-14 items-center justify-center rounded-full bg-red-50">
                <SearchX className="size-7 text-red-500" aria-hidden="true" />
              </span>
              <p className="font-semibold">Couldn&apos;t load medicines</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Something went wrong while fetching the catalog. Please try again.
              </p>
              <Button className="mt-2 h-11 rounded-xl" onClick={() => setReloadNonce((n) => n + 1)}>
                Try again
              </Button>
            </Card>
          ) : data.medicines.length === 0 ? (
            <Card className="items-center gap-3 p-10 text-center shadow-sm">
              <span className="flex size-14 items-center justify-center rounded-full bg-muted">
                <SearchX className="size-7 text-muted-foreground" aria-hidden="true" />
              </span>
              <p className="font-semibold">No medicines found</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Try adjusting your search or filters — or browse the full catalog.
              </p>
              <Button className="mt-2 h-11 rounded-xl" onClick={clearAll}>
                Clear all filters
              </Button>
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:gap-4">
              {data.medicines.map((m) => (
                <MedicineCard key={m.id} medicine={m} onView={setDetailMedicine} />
              ))}
            </div>
          )}

          {/* Pagination */}
          {!loading && data && data.medicines.length > 0 && (
            <nav
              className="mt-8 flex items-center justify-center gap-4"
              aria-label="Catalog pagination"
            >
              <Button
                variant="outline"
                className="h-11 rounded-xl"
                disabled={filters.page <= 1}
                onClick={() => setFilters({ page: filters.page - 1 })}
              >
                Previous
              </Button>
              <p className="text-sm text-muted-foreground">
                Page <span className="font-semibold text-foreground">{filters.page}</span> of{' '}
                <span className="font-semibold text-foreground">{pages}</span>
              </p>
              <Button
                variant="outline"
                className="h-11 rounded-xl"
                disabled={filters.page >= pages}
                onClick={() => setFilters({ page: filters.page + 1 })}
              >
                Next
              </Button>
            </nav>
          )}
        </div>
      </div>
    </div>
  )
}
