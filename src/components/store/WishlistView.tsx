'use client'

import { useCallback, useEffect, useState } from 'react'
import { Heart, LogIn, Loader2, RefreshCw, ShoppingBag, TriangleAlert } from 'lucide-react'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import type { WishlistItem } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import MedicineCard, { addToCart } from '@/components/store/MedicineCard'

export default function WishlistView() {
  const user = useAppStore((s) => s.user)
  const wishlistIds = useAppStore((s) => s.wishlistIds)
  const setWishlistIds = useAppStore((s) => s.setWishlistIds)
  const setView = useAppStore((s) => s.setView)
  const setDetailMedicine = useAppStore((s) => s.setDetailMedicine)
  const [items, setItems] = useState<WishlistItem[] | null>(null)
  // A failed load is not an empty wishlist — it used to render the "nothing saved yet"
  // card, which quietly told the user their saved items were gone.
  const [error, setError] = useState<string | null>(null)
  const [addingAll, setAddingAll] = useState(false)

  const load = useCallback(async () => {
    if (!user) return
    setError(null)
    try {
      const d = await api<{ items: WishlistItem[]; ids: string[] }>('/api/wishlist')
      setItems(d.items)
      setWishlistIds(d.ids)
    } catch (e) {
      setItems(null)
      setError(e instanceof Error ? e.message : 'Failed to load your wishlist')
    }
  }, [user, setWishlistIds])

  useEffect(() => {
    void load()
  }, [load])

  // If a heart on a card removed an item, drop it from the local list too
  const visible = items?.filter((i) => wishlistIds.includes(i.medicine.id)) ?? items

  if (!user) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-24 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-primary/10">
          <LogIn className="size-7 text-primary" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-bold">Sign in to see your wishlist</h1>
        <p className="text-sm text-muted-foreground">
          Save medicines you love and find them here anytime.
        </p>
        <Button onClick={() => useAppStore.getState().setAuthOpen(true)}>Sign in</Button>
      </div>
    )
  }

  // Guarded: the cart POST is additive, so a second click while the loop is still
  // running would add every in-stock item a second time.
  const addAllToCart = async () => {
    if (!visible?.length || addingAll) return
    setAddingAll(true)
    try {
      for (const it of visible) {
        if (it.medicine.stock > 0) await addToCart(it.medicine, 1)
      }
    } finally {
      setAddingAll(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Heart className="size-6 fill-primary text-primary" aria-hidden="true" />
            My wishlist
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {error
              ? 'Unavailable'
              : visible
                ? `${visible.length} saved ${visible.length === 1 ? 'medicine' : 'medicines'}`
                : 'Loading…'}
          </p>
        </div>
        {!!visible?.length && (
          <Button onClick={() => void addAllToCart()} disabled={addingAll}>
            {addingAll ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <ShoppingBag className="size-4" aria-hidden="true" />
            )}
            {addingAll ? 'Adding…' : 'Add all in-stock to cart'}
          </Button>
        )}
      </div>

      {error ? (
        <Card className="mt-6 flex flex-col items-center gap-3 border-dashed p-12 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-500/15">
            <TriangleAlert className="size-6 text-amber-700 dark:text-amber-400" aria-hidden="true" />
          </div>
          <h2 className="text-lg font-semibold">Could not load your wishlist</h2>
          <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" onClick={() => void load()}>
            <RefreshCw className="size-4" aria-hidden="true" /> Try again
          </Button>
        </Card>
      ) : visible === null ? (
        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-72 rounded-xl" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <Card className="mt-6 flex flex-col items-center gap-3 border-dashed p-12 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-primary/10">
            <Heart className="size-6 text-primary" aria-hidden="true" />
          </div>
          <h2 className="text-lg font-semibold">Your wishlist is empty</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Tap the heart icon on any medicine to save it here for later.
          </p>
          <Button onClick={() => setView('catalog')}>Browse medicines</Button>
        </Card>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((it) => (
            <MedicineCard key={it.id} medicine={it.medicine} onView={(m) => setDetailMedicine(m)} />
          ))}
        </div>
      )}
    </div>
  )
}
