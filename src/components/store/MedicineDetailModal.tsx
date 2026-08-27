'use client'

import { useState } from 'react'
import {
  CalendarClock,
  FileWarning,
  Minus,
  Package,
  Plus,
  ShoppingCart,
  Tags,
} from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { effectivePrice, fmtBDT, fmtDate, stockLabel } from '@/lib/format'
import type { Medicine } from '@/lib/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { MedImage, addToCart } from '@/components/store/MedicineCard'
import { cn } from '@/lib/utils'

const stockToneClass: Record<string, string> = {
  in: 'text-emerald-600',
  low: 'text-amber-600',
  out: 'text-red-600',
}

/** Inner body — keyed by medicine id so qty/adding state resets per product */
function DetailBody({ medicine: m }: { medicine: Medicine }) {
  const setDetailMedicine = useAppStore((s) => s.setDetailMedicine)
  const [qty, setQty] = useState(1)
  const [adding, setAdding] = useState(false)

  const price = effectivePrice(m)
  const stock = stockLabel(m.stock)
  const out = m.stock <= 0
  const maxQty = Math.max(1, m.stock)

  const changeQty = (delta: number) => {
    setQty((q) => Math.min(Math.max(1, q + delta), maxQty))
  }

  const handleAdd = async () => {
    setAdding(true)
    const ok = await addToCart(m, qty)
    setAdding(false)
    if (ok) setDetailMedicine(null)
  }

  return (
    <div className="grid gap-6 p-4 sm:p-6 md:grid-cols-2">
      {/* Image */}
      <div className="relative">
        <MedImage
          src={m.image}
          alt={m.name}
          className="aspect-square w-full rounded-xl border bg-card"
        />
        {m.requiresPrescription && (
          <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-md bg-amber-400 px-2 py-1 text-xs font-semibold text-amber-950 shadow-sm">
            <FileWarning className="size-3.5" aria-hidden="true" />
            Prescription required
          </span>
        )}
      </div>

      {/* Info */}
      <div className="flex min-w-0 flex-col">
        <h2 className="text-xl font-bold leading-tight tracking-tight">{m.name}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {[m.brand, m.manufacturer].filter(Boolean).join(' · ') || '—'}
        </p>
        {m.genericName && (
          <p className="mt-0.5 text-sm text-muted-foreground">
            Generic: <span className="font-medium text-foreground">{m.genericName}</span>
          </p>
        )}

        <p className="mt-3 text-2xl font-extrabold text-primary">{fmtBDT(price)}</p>
        {price < m.price && (
          <p className="text-sm text-muted-foreground">
            <span className="line-through">{fmtBDT(m.price)}</span>{' '}
            <span className="font-medium text-red-600">save {fmtBDT(m.price - price)}</span>
          </p>
        )}

        {m.description && (
          <p className="mt-3 line-clamp-4 text-sm leading-relaxed text-muted-foreground">
            {m.description}
          </p>
        )}

        <Separator className="my-4" />

        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-muted-foreground">
              <Package className="size-4" aria-hidden="true" />
              Stock
            </span>
            <span className={cn('font-semibold', stockToneClass[stock.tone])}>{stock.text}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-muted-foreground">
              <Tags className="size-4" aria-hidden="true" />
              Unit
            </span>
            <span className="font-medium">{m.unit}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-muted-foreground">
              <CalendarClock className="size-4" aria-hidden="true" />
              Expiry
            </span>
            <span className="font-medium">{fmtDate(m.expiryDate)}</span>
          </div>
        </div>

        {m.requiresPrescription && (
          <Alert className="mt-4 border-amber-300 bg-amber-50 text-amber-900">
            <FileWarning className="size-4 text-amber-600" aria-hidden="true" />
            <AlertTitle>Prescription required</AlertTitle>
            <AlertDescription className="text-amber-800">
              Upload or select an approved prescription at checkout.
            </AlertDescription>
          </Alert>
        )}

        {/* Qty + subtotal + add */}
        <div className="mt-5 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">Quantity</p>
            <div className="mt-1 flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className="size-11 rounded-xl"
                disabled={out || qty <= 1}
                onClick={() => changeQty(-1)}
                aria-label="Decrease quantity"
              >
                <Minus className="size-4" aria-hidden="true" />
              </Button>
              <span
                className="w-10 text-center text-lg font-semibold"
                aria-live="polite"
                aria-label={`Quantity ${qty}`}
              >
                {out ? 0 : qty}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="size-11 rounded-xl"
                disabled={out || qty >= maxQty}
                onClick={() => changeQty(1)}
                aria-label="Increase quantity"
              >
                <Plus className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Subtotal</p>
            <p className="text-lg font-bold">{fmtBDT(price * (out ? 0 : qty))}</p>
          </div>
        </div>

        <Button
          className="mt-5 h-11 w-full rounded-xl"
          disabled={out || adding}
          onClick={() => void handleAdd()}
        >
          <ShoppingCart className="size-4" aria-hidden="true" />
          {out ? 'Out of Stock' : adding ? 'Adding…' : 'Add to cart'}
        </Button>
      </div>
    </div>
  )
}

export default function MedicineDetailModal() {
  const medicine = useAppStore((s) => s.detailMedicine)
  const setDetailMedicine = useAppStore((s) => s.setDetailMedicine)

  if (!medicine) return null

  return (
    <Dialog open onOpenChange={(open) => !open && setDetailMedicine(null)}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-y-auto p-0 sm:max-w-2xl scrollbar-thin">
        <DialogHeader className="sr-only">
          <DialogTitle>{medicine.name}</DialogTitle>
          <DialogDescription>Medicine details</DialogDescription>
        </DialogHeader>
        <DetailBody key={medicine.id} medicine={medicine} />
      </DialogContent>
    </Dialog>
  )
}
