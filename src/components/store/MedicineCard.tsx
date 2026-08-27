'use client'

import { useState } from 'react'
import { FileWarning, Pill, ShoppingCart } from 'lucide-react'
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
  const price = effectivePrice(medicine)
  const pct = discountPercent(medicine)
  const stock = stockLabel(medicine.stock)
  const out = medicine.stock <= 0

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={`View ${medicine.name}`}
      onClick={() => onView(medicine)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onView(medicine)
        }
      }}
      className="group relative cursor-pointer gap-0 overflow-hidden py-0 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-1 p-4">
        <p className="line-clamp-1 font-medium">{medicine.name}</p>
        {medicine.genericName && (
          <p className="line-clamp-1 text-xs text-muted-foreground">{medicine.genericName}</p>
        )}
        <p className={cn('text-xs font-medium', stockToneClass[stock.tone])}>{stock.text}</p>

        <div className="mt-1 flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
            <span className="text-base font-bold text-primary">{fmtBDT(price)}</span>
            {pct > 0 && (
              <span className="text-xs text-muted-foreground line-through">{fmtBDT(medicine.price)}</span>
            )}
          </div>
          <Button
            size="icon"
            aria-label={`Add ${medicine.name} to cart`}
            disabled={out}
            className="size-11 shrink-0 rounded-xl"
            onClick={(e) => {
              e.stopPropagation()
              void addToCart(medicine, 1)
            }}
          >
            <ShoppingCart className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </Card>
  )
}
