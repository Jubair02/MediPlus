'use client'

import { useCallback, useState } from 'react'
import { FileWarning, Heart, Images, Loader2, Pill, ShoppingCart, Star } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { discountPercent, effectivePrice, fmtBDT, stockLabel } from '@/lib/format'
import type { CartItem, Medicine } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/**
 * Shared image helper — renders `src` when available, and gracefully falls back
 * to a soft pharmacy-gradient placeholder with a Pill icon on error / absence.
 */
export function MedImage({
  src,
  alt,
  className,
}: {
  src?: string | null
  alt: string
  className?: string
}) {
  const [failed, setFailed] = useState(false)

  // Catch images that failed BEFORE React attached onError (hydration race)
  const imgRef = useCallback((node: HTMLImageElement | null) => {
    if (node && node.complete && node.naturalWidth === 0) setFailed(true)
  }, [])

  if (!src || failed) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={cn('med-gradient flex items-center justify-center', className)}
      >
        <Pill className="size-10 text-white drop-shadow-sm" aria-hidden="true" />
      </div>
    )
  }

  return (
    <img
      ref={imgRef}
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn('object-cover', className)}
    />
  )
}

/**
 * Shared add-to-cart flow (used by MedicineCard + MedicineDetailModal).
 * Resolves to `true` when the item was added successfully.
 */
export async function addToCart(medicine: Medicine, quantity = 1): Promise<boolean> {
  const { user, setAuthOpen, setCartCount } = useAppStore.getState()
  if (!user) {
    setAuthOpen(true)
    toast.info('Please sign in to add items')
    return false
  }
  try {
    const data = await api<{ items: CartItem[] }>('/api/cart', {
      method: 'POST',
      body: { medicineId: medicine.id, quantity },
    })
    setCartCount(data.items.length)
    toast.success(`${medicine.name} added to cart`)
    return true
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Failed to add to cart')
    return false
  }
}

/**
 * Shared wishlist toggle (used by MedicineCard + MedicineDetailModal).
 * Resolves to the new "in wishlist" state, or null when not signed in.
 */
export async function toggleWishlist(medicineId: string): Promise<boolean | null> {
  const { user, setAuthOpen } = useAppStore.getState()
  if (!user) {
    setAuthOpen(true)
    toast.info('Please sign in to save favourites')
    return null
  }
  try {
    const d = await api<{ ids: string[]; added: boolean }>('/api/wishlist', {
      method: 'POST',
      body: { medicineId },
    })
    // `d.ids` is the full post-toggle list, so it already reflects the add/remove. It used
    // to be followed by toggleWishlistId(), which appended the same id a second time and
    // inflated the header badge by one on every add.
    useAppStore.getState().setWishlistIds(d.ids)
    toast.success(d.added ? 'Saved to your wishlist' : 'Removed from wishlist')
    return d.added
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Failed to update wishlist')
    return null
  }
}

const stockToneClass: Record<string, string> = {
  in: 'text-emerald-600',
  low: 'text-amber-600',
  out: 'text-red-600',
}

export default function MedicineCard({
  medicine,
  onView,
}: {
  medicine: Medicine
  onView: (m: Medicine) => void
}) {
  const [adding, setAdding] = useState(false)
  const price = effectivePrice(medicine)
  const pct = discountPercent(medicine)
  const stock = stockLabel(medicine.stock)
  const out = medicine.stock <= 0
  const wishlisted = useAppStore((s) => s.wishlistIds.includes(medicine.id))
  const showRating = typeof medicine.rating === 'number' && (medicine.ratingCount ?? 0) > 0

  const onHeart = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      void toggleWishlist(medicine.id)
    },
    [medicine.id]
  )

  // The cart POST is additive, so a double click used to add the item twice.
  const onAdd = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      if (adding) return
      setAdding(true)
      try {
        await addToCart(medicine, 1)
      } finally {
        setAdding(false)
      }
    },
    [adding, medicine]
  )

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={`View ${medicine.name}`}
      onClick={() => onView(medicine)}
      onKeyDown={(e) => {
        // Only act on keys aimed at the card itself. Without this, Enter on the nested
        // "Add to cart" / wishlist buttons bubbled up here and opened the detail modal
        // instead of activating the button.
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onView(medicine)
        }
      }}
      className="group relative cursor-pointer gap-0 overflow-hidden py-0 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2"
    >
      {/* Image area */}
      <div className="relative aspect-square w-full overflow-hidden rounded-t-xl">
        <MedImage
          src={medicine.image}
          alt={medicine.name}
          className="h-full w-full transition-transform duration-300 group-hover:scale-[1.03]"
        />
        {pct > 0 && (
          <span className="absolute left-2 top-2 rounded-md bg-red-500 px-1.5 py-0.5 text-xs font-semibold text-white shadow-sm">
            -{pct}%
          </span>
        )}
        {medicine.requiresPrescription && (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-amber-400 px-1.5 py-0.5 text-xs font-semibold text-amber-950 shadow-sm">
            <FileWarning className="size-3" aria-hidden="true" />
            Rx
          </span>
        )}
        {out && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <span className="rounded-md bg-black/50 px-3 py-1.5 text-sm font-semibold text-white">
              Out of Stock
            </span>
          </div>
        )}
        {/* Multi-image hint — opens the gallery in the detail modal (decorative) */}
        {(medicine.imageCount ?? 0) > 1 && (
          <span
            aria-hidden="true"
            className="absolute bottom-1.5 left-1.5 z-10 inline-flex items-center gap-1 rounded-full border bg-background/90 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-foreground/80 shadow-sm"
          >
            <Images className="size-3" aria-hidden="true" />
            {medicine.imageCount}
          </span>
        )}
        <button
          type="button"
          aria-label={wishlisted ? `Remove ${medicine.name} from wishlist` : `Save ${medicine.name} to wishlist`}
          aria-pressed={wishlisted}
          onClick={onHeart}
          className="absolute bottom-2 right-2 z-10 flex size-9 items-center justify-center rounded-full bg-white/90 shadow-md backdrop-blur transition hover:scale-110 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Heart
            className={cn(
              'size-4 transition-colors',
              wishlisted ? 'fill-red-500 text-red-500' : 'text-gray-500'
            )}
            aria-hidden="true"
          />
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-1 p-4">
        <p className="line-clamp-1 font-medium">{medicine.name}</p>
        {medicine.genericName && (
          <p className="line-clamp-1 text-xs text-muted-foreground">{medicine.genericName}</p>
        )}
        <div className="flex items-center justify-between gap-2">
          <p className={cn('text-xs font-medium', stockToneClass[stock.tone])}>{stock.text}</p>
          {showRating && (
            <span
              className="inline-flex items-center gap-1 whitespace-nowrap text-xs"
              title={`${medicine.rating?.toFixed(1)} out of 5`}
            >
              <Star className="size-3 fill-amber-400 text-amber-400" aria-hidden="true" />
              <span className="font-medium">{medicine.rating?.toFixed(1)}</span>
              <span className="text-muted-foreground">({medicine.ratingCount})</span>
            </span>
          )}
        </div>

        <div className="mt-1 flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 tabular-nums">
            <span className="text-base font-bold text-primary">{fmtBDT(price)}</span>
            {pct > 0 && (
              <span className="text-xs text-muted-foreground line-through">{fmtBDT(medicine.price)}</span>
            )}
          </div>
          <Button
            size="icon"
            aria-label={`Add ${medicine.name} to cart`}
            disabled={out || adding}
            className="size-11 shrink-0 rounded-xl"
            onClick={(e) => void onAdd(e)}
          >
            {adding ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <ShoppingCart className="size-4" aria-hidden="true" />
            )}
          </Button>
        </div>
      </div>
    </Card>
  )
}
