'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, FileWarning, LogIn, Minus, Plus, ShoppingBag, ShoppingCart, Truck, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { effectivePrice, fmtBDT, FREE_DELIVERY_THRESHOLD } from '@/lib/format'
import type { CartItem } from '@/lib/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { MedImage } from '@/components/store/MedicineCard'

export default function CartView() {
  const user = useAppStore((s) => s.user)
  const setView = useAppStore((s) => s.setView)
  const setAuthOpen = useAppStore((s) => s.setAuthOpen)
  const setCartCount = useAppStore((s) => s.setCartCount)
  const setDetailMedicine = useAppStore((s) => s.setDetailMedicine)

  const [items, setItems] = useState<CartItem[] | null>(null)

  useEffect(() => {
    if (!user) return
    const ac = new AbortController()
    api<{ items: CartItem[] }>('/api/cart', { signal: ac.signal })
      .then((d) => {
        setItems(d.items)
        setCartCount(d.items.length)
      })
      .catch(() => {})
    return () => ac.abort()
  }, [user, setCartCount])

  // ---------- mutations (optimistic, revert on error) ----------
  const replaceFromServer = (next: CartItem[]) => {
    setItems(next)
    setCartCount(next.length)
  }

  const updateQuantity = (item: CartItem, next: number) => {
    if (!items) return
    if (next < 1 || next > item.medicine.stock) return
    const prev = items
    setItems(prev.map((i) => (i.id === item.id ? { ...i, quantity: next } : i)))
    api<{ items: CartItem[] }>('/api/cart', {
      method: 'PUT',
      body: { itemId: item.id, quantity: next },
    })
      .then((d) => replaceFromServer(d.items))
      .catch((err) => {
        setItems(prev)
        setCartCount(prev.length)
        toast.error(err instanceof Error ? err.message : 'Failed to update quantity')
      })
  }

  const removeItem = (item: CartItem) => {
    if (!items) return
    const prev = items
    setItems(prev.filter((i) => i.id !== item.id))
    api<{ items: CartItem[] }>(`/api/cart?itemId=${encodeURIComponent(item.id)}`, {
      method: 'DELETE',
    })
      .then((d) => replaceFromServer(d.items))
      .catch((err) => {
        setItems(prev)
        setCartCount(prev.length)
        toast.error(err instanceof Error ? err.message : 'Failed to remove item')
      })
  }

  // ---------- guard ----------
  if (!user) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-primary/10">
          <LogIn className="size-8 text-primary" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-xl font-bold">Sign in to view your cart</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your cart is saved to your account so you can pick up where you left off.
        </p>
        <Button className="mt-6 h-11 rounded-xl" onClick={() => setAuthOpen(true)}>
          <LogIn className="size-4" aria-hidden="true" />
          Sign in
        </Button>
      </div>
    )
  }

  // ---------- loading ----------
  if (items === null) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 lg:px-6">
        <Skeleton className="mb-6 h-8 w-48" />
        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    )
  }

  const subtotal = items.reduce((sum, i) => sum + effectivePrice(i.medicine) * i.quantity, 0)
  const needsRx = items.some((i) => i.medicine.requiresPrescription)

  // ---------- empty ----------
  if (items.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-primary/10">
          <ShoppingBag className="size-8 text-primary" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-xl font-bold">Your cart is empty</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Browse medicines and add them to your cart to get started.
        </p>
        <Button className="mt-6 h-11 rounded-xl" onClick={() => setView('catalog')}>
          <ShoppingCart className="size-4" aria-hidden="true" />
          Browse medicines
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 lg:px-6">
      <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
        Your cart{' '}
        <span className="text-sm font-normal text-muted-foreground">
          ({items.length} {items.length === 1 ? 'item' : 'items'})
        </span>
      </h1>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
        {/* Items */}
        <div className="space-y-4">
          {items.map((item) => {
            const med = item.medicine
            const unit = effectivePrice(med)
            return (
              <Card key={item.id} className="flex-row items-center gap-4 p-4 shadow-sm">
                <button
                  type="button"
                  className="shrink-0 overflow-hidden rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setDetailMedicine(med)}
                  aria-label={`View ${med.name}`}
                >
                  <MedImage src={med.image} alt={med.name} className="size-20 w-20" />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-1 font-medium">{med.name}</p>
                  {med.genericName && (
                    <p className="line-clamp-1 text-xs text-muted-foreground">{med.genericName}</p>
                  )}
                  <p className="mt-0.5 text-sm">
                    <span className="font-semibold text-primary">{fmtBDT(unit)}</span>{' '}
                    <span className="text-xs text-muted-foreground">/ {med.unit}</span>
                  </p>

                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="icon"
                        className="size-9 rounded-lg"
                        disabled={item.quantity <= 1}
                        onClick={() => updateQuantity(item, item.quantity - 1)}
                        aria-label={`Decrease quantity of ${med.name}`}
                      >
                        <Minus className="size-3.5" aria-hidden="true" />
                      </Button>
                      <span
                        className="w-8 text-center text-sm font-semibold"
                        aria-label={`Quantity ${item.quantity}`}
                      >
                        {item.quantity}
                      </span>
                      <Button
                        variant="outline"
                        size="icon"
                        className="size-9 rounded-lg"
                        disabled={item.quantity >= med.stock}
                        onClick={() => updateQuantity(item, item.quantity + 1)}
                        aria-label={`Increase quantity of ${med.name}`}
                      >
                        <Plus className="size-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                    <p className="ml-auto text-sm font-semibold">
                      {fmtBDT(unit * item.quantity)}
                    </p>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-9 rounded-lg text-red-600 hover:bg-red-50 hover:text-red-600"
                      onClick={() => removeItem(item)}
                      aria-label={`Remove ${med.name} from cart`}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>

        {/* Summary */}
        <Card className="sticky top-28 gap-0 p-5 shadow-sm">
          <h2 className="font-semibold">Order summary</h2>
          <Separator className="my-4" />
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="font-semibold">{fmtBDT(subtotal)}</span>
          </div>

          {/* Free delivery progress */}
          {subtotal >= FREE_DELIVERY_THRESHOLD ? (
            <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
              You've unlocked FREE delivery
            </p>
          ) : (
            <div className="mt-3 rounded-lg border border-dashed p-3">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Truck className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                <span>
                  Add <span className="font-semibold text-primary">{fmtBDT(FREE_DELIVERY_THRESHOLD - subtotal)}</span> more for{' '}
                  <span className="font-medium text-foreground">FREE delivery</span>
                </span>
              </p>
              <Progress
                value={Math.min(100, (subtotal / FREE_DELIVERY_THRESHOLD) * 100)}
                className="mt-2 h-1.5"
                aria-label={`Progress towards free delivery: ${Math.round((subtotal / FREE_DELIVERY_THRESHOLD) * 100)}%`}
              />
            </div>
          )}

          <p className="mt-2 text-xs text-muted-foreground">
            Delivery fee is calculated at checkout.
          </p>

          {needsRx && (
            <Alert className="mt-4 border-amber-300 bg-amber-50 text-amber-900">
              <FileWarning className="size-4 text-amber-600" aria-hidden="true" />
              <AlertTitle>Prescription needed</AlertTitle>
              <AlertDescription className="text-amber-800">
                Your cart contains prescription medicines — an approved prescription is needed at
                checkout.
              </AlertDescription>
            </Alert>
          )}

          <Button
            className="mt-5 h-11 w-full rounded-xl"
            onClick={() => setView('checkout')}
          >
            Proceed to checkout
          </Button>
          <Button
            variant="link"
            className="mt-1 h-11 w-full"
            onClick={() => setView('catalog')}
          >
            Continue shopping
          </Button>
        </Card>
      </div>
    </div>
  )
}
