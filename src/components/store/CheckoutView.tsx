'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Banknote,
  CheckCircle2,
  FileText,
  FileWarning,
  ImagePlus,
  Loader2,
  LogIn,
  MapPin,
  Plus,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  StickyNote,
  Tag,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, fileToCompressedDataUrl } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { DELIVERY_FEE, effectivePrice, fmtBDT, fmtDate } from '@/lib/format'
import type { Address, CartItem, CouponInfo, Order, PaymentMethod, Prescription } from '@/lib/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import AddressFormDialog from '@/components/store/AddressFormDialog'
import BkashPayDialog from '@/components/store/BkashPayDialog'
import { MedImage } from '@/components/store/MedicineCard'
import { cn } from '@/lib/utils'

const FREE_DELIVERY_THRESHOLD = 2000
const MAX_NOTES = 600

export default function CheckoutView() {
  const user = useAppStore((s) => s.user)
  const setView = useAppStore((s) => s.setView)
  const setAuthOpen = useAppStore((s) => s.setAuthOpen)
  const setCartCount = useAppStore((s) => s.setCartCount)
  const setSuccessOrderNo = useAppStore((s) => s.setSuccessOrderNo)

  const [ready, setReady] = useState(false)
  const [cartItems, setCartItems] = useState<CartItem[] | null>(null)
  const [addresses, setAddresses] = useState<Address[]>([])
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null)
  const [addressDialogOpen, setAddressDialogOpen] = useState(false)

  const [approvedRx, setApprovedRx] = useState<Prescription[]>([])
  const [selectedRxId, setSelectedRxId] = useState<string | null>(null)
  const [upload, setUpload] = useState<{ image: string; note: string } | null>(null)
  const [processingFile, setProcessingFile] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [coupon, setCoupon] = useState<CouponInfo | null>(null)
  const [couponInput, setCouponInput] = useState('')
  const [applyingCoupon, setApplyingCoupon] = useState(false)

  const [payment, setPayment] = useState<PaymentMethod>('COD')
  const [placing, setPlacing] = useState(false)
  const [placedOrder, setPlacedOrder] = useState<Order | null>(null)
  const [bkashOpen, setBkashOpen] = useState(false)
  const [notes, setNotes] = useState('')

  // ---------- initial load ----------
  useEffect(() => {
    if (!user) return
    const ac = new AbortController()
    const load = async () => {
      try {
        const [cartRes, addrRes] = await Promise.all([
          api<{ items: CartItem[] }>('/api/cart', { signal: ac.signal }),
          api<{ addresses: Address[] }>('/api/addresses', { signal: ac.signal }),
        ])
        if (ac.signal.aborted) return
        setCartItems(cartRes.items)
        setCartCount(cartRes.items.length)
        setAddresses(addrRes.addresses)
        const preferred = addrRes.addresses.find((a) => a.isDefault) ?? addrRes.addresses[0]
        if (preferred?.id) setSelectedAddressId(preferred.id)

        if (cartRes.items.some((i) => i.medicine.requiresPrescription)) {
          const rxRes = await api<{ prescriptions: Prescription[] }>('/api/prescriptions', {
            signal: ac.signal,
          })
          if (ac.signal.aborted) return
          const approved = rxRes.prescriptions.filter((p) => p.status === 'APPROVED')
          setApprovedRx(approved)
          if (approved[0]?.id) setSelectedRxId(approved[0].id)
        }
      } catch (err) {
        if (!ac.signal.aborted) {
          toast.error(err instanceof Error ? err.message : 'Failed to load checkout')
        }
      } finally {
        if (!ac.signal.aborted) setReady(true)
      }
    }
    void load()
    return () => ac.abort()
  }, [user, setCartCount])

  // ---------- guard: signed out ----------
  if (!user) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-primary/10">
          <LogIn className="size-8 text-primary" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-xl font-bold">Sign in to checkout</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          You need an account to place an order and track its delivery.
        </p>
        <Button className="mt-6 h-11 rounded-xl" onClick={() => setAuthOpen(true)}>
          <LogIn className="size-4" aria-hidden="true" />
          Sign in
        </Button>
      </div>
    )
  }

  const needsRx = (cartItems ?? []).some((i) => i.medicine.requiresPrescription)
  const subtotal = (cartItems ?? []).reduce(
    (sum, i) => sum + effectivePrice(i.medicine) * i.quantity,
    0
  )
  const discount = coupon?.discount ?? 0
  const deliveryFee = subtotal >= FREE_DELIVERY_THRESHOLD ? 0 : DELIVERY_FEE
  const total = Math.max(0, subtotal - discount) + deliveryFee
  const rxReady = !needsRx || selectedRxId != null || !!upload?.image
  const canPlace =
    ready && (cartItems?.length ?? 0) > 0 && !!selectedAddressId && rxReady && !placing

  // ---------- actions ----------
  const onPickFile = async (file: File | undefined) => {
    if (!file) return
    setProcessingFile(true)
    try {
      const dataUrl = await fileToCompressedDataUrl(file)
      setUpload({ image: dataUrl, note: '' })
      setSelectedRxId(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not read that image')
    } finally {
      setProcessingFile(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const applyCoupon = async () => {
    const code = couponInput.trim()
    if (!code) return
    setApplyingCoupon(true)
    try {
      const d = await api<{ coupon: CouponInfo }>('/api/coupons', {
        method: 'POST',
        body: { code, subtotal },
      })
      setCoupon(d.coupon)
      toast.success(`Coupon ${d.coupon.code} applied — you save ${fmtBDT(d.coupon.discount)}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Invalid coupon')
    } finally {
      setApplyingCoupon(false)
    }
  }

  const placeOrder = async () => {
    if (!canPlace) return
    setPlacing(true)
    try {
      const body: Record<string, unknown> = {
        paymentMethod: payment,
        ...(coupon ? { couponCode: coupon.code } : {}),
      }
      if (selectedAddressId) body.addressId = selectedAddressId
      const trimmedNotes = notes.trim()
      if (trimmedNotes) body.notes = trimmedNotes
      if (needsRx) {
        if (upload?.image) {
          body.prescription = { image: upload.image, note: upload.note.trim() || undefined }
        } else if (selectedRxId) {
          body.prescriptionId = selectedRxId
        }
      }
      const d = await api<{ order: Order }>('/api/orders', { method: 'POST', body })
      setPlacedOrder(d.order)
      setSuccessOrderNo(d.order.orderNo)
      setCartCount(0)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to place order')
    } finally {
      setPlacing(false)
    }
  }

  const addressSaved = (a: Address) => {
    setAddresses((prev) => {
      const exists = prev.some((p) => p.id === a.id)
      const next = exists ? prev.map((p) => (p.id === a.id ? a : p)) : [...prev, a]
      return a.isDefault ? next.map((p) => ({ ...p, isDefault: p.id === a.id })) : next
    })
    if (a.id) setSelectedAddressId(a.id)
  }

  // ---------- loading skeleton ----------
  if (!ready) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 lg:px-6">
        <Skeleton className="mb-6 h-8 w-56" />
        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-40 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-80 rounded-xl" />
        </div>
      </div>
    )
  }

  // ---------- empty cart ----------
  if (!cartItems || cartItems.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-primary/10">
          <ShoppingBag className="size-8 text-primary" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-xl font-bold">Nothing to check out</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your cart is empty — add some medicines first.
        </p>
        <Button className="mt-6 h-11 rounded-xl" onClick={() => setView('catalog')}>
          Browse medicines
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 lg:px-6">
      <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Checkout</h1>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
        {/* ---------- Left column ---------- */}
        <div className="space-y-6">
          {/* 1. Delivery address */}
          <Card className="gap-4 p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 font-semibold">
                <MapPin className="size-4 text-primary" aria-hidden="true" />
                Delivery address
              </h2>
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1.5 rounded-lg"
                onClick={() => setAddressDialogOpen(true)}
              >
                <Plus className="size-4" aria-hidden="true" />
                Add new
              </Button>
            </div>

            {addresses.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                No saved addresses yet — add one so we know where to deliver.
              </p>
            ) : (
              <div role="radiogroup" aria-label="Delivery address" className="grid gap-3 sm:grid-cols-2">
                {addresses.map((a) => {
                  const selected = selectedAddressId === a.id
                  return (
                    <button
                      key={a.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => a.id && setSelectedAddressId(a.id)}
                      className={cn(
                        'rounded-xl border p-4 text-left transition-all',
                        selected
                          ? 'border-primary bg-primary/5 ring-1 ring-primary'
                          : 'shadow-sm hover:border-primary/40'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="rounded-md">
                          {a.label}
                        </Badge>
                        {a.isDefault && (
                          <Badge className="rounded-md bg-emerald-100 text-emerald-700">Default</Badge>
                        )}
                      </div>
                      <p className="mt-2 text-sm font-semibold">{a.recipient}</p>
                      <p className="text-xs text-muted-foreground">{a.phone}</p>
                      <p className="mt-1 text-sm leading-snug">
                        {a.line1}
                        {a.area ? `, ${a.area}` : ''}, {a.city}
                        {a.postcode ? ` ${a.postcode}` : ''}
                      </p>
                    </button>
                  )
                })}
              </div>
            )}
          </Card>

          {/* 2. Prescription (only when cart contains Rx medicines) */}
          {needsRx && (
            <Card className="gap-4 p-5 shadow-sm">
              <h2 className="flex items-center gap-2 font-semibold">
                <FileWarning className="size-4 text-amber-600" aria-hidden="true" />
                Prescription
              </h2>
              <Alert className="border-amber-300 bg-amber-50 text-amber-900">
                <FileWarning className="size-4 text-amber-600" aria-hidden="true" />
                <AlertTitle>Pharmacist approval required</AlertTitle>
                <AlertDescription className="text-amber-800">
                  Your prescription must be approved by a licensed pharmacist before your order is
                  processed.
                </AlertDescription>
              </Alert>

              <Tabs defaultValue="select">
                <TabsList className="w-full sm:w-auto">
                  <TabsTrigger value="select">Select approved</TabsTrigger>
                  <TabsTrigger value="upload">Upload new</TabsTrigger>
                </TabsList>

                <TabsContent value="select" className="mt-3">
                  {approvedRx.length === 0 ? (
                    <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                      You have no approved prescriptions yet. Upload a new one — a pharmacist will
                      review it shortly.
                    </p>
                  ) : (
                    <div role="radiogroup" aria-label="Approved prescriptions" className="grid gap-2">
                      {approvedRx.map((p) => {
                        const selected = selectedRxId === p.id
                        return (
                          <button
                            key={p.id}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => {
                              setSelectedRxId(p.id)
                              setUpload(null)
                            }}
                            className={cn(
                              'flex items-center gap-3 rounded-xl border p-3 text-left transition-all',
                              selected
                                ? 'border-primary bg-primary/5 ring-1 ring-primary'
                                : 'shadow-sm hover:border-primary/40'
                            )}
                          >
                            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                              <FileText className="size-5 text-primary" aria-hidden="true" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-medium">
                                Prescription · {fmtDate(p.createdAt)}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {p.note || 'No note attached'}
                              </span>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="upload" className="mt-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => void onPickFile(e.target.files?.[0])}
                  />
                  {upload?.image ? (
                    <div className="space-y-3">
                      <img
                        src={upload.image}
                        alt="Prescription preview"
                        className="max-h-48 w-auto rounded-lg border"
                      />
                      <Textarea
                        placeholder="Note for the pharmacist (optional)"
                        value={upload.note}
                        onChange={(e) => setUpload((u) => (u ? { ...u, note: e.target.value } : u))}
                        className="min-h-20"
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                    >
                      {processingFile ? (
                        <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
                      ) : (
                        <ImagePlus className="size-6 text-primary" aria-hidden="true" />
                      )}
                      {processingFile ? 'Processing image…' : 'Tap to choose a prescription photo'}
                    </button>
                  )}
                </TabsContent>
              </Tabs>
            </Card>
          )}

          {/* 3. Payment */}
          <Card className="gap-4 p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">Payment method</h2>
              <div className="flex items-center gap-1.5" aria-hidden="true">
                <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                  Cash
                </span>
                <span className="rounded-md bg-[#E2136E] px-1.5 py-0.5 text-[10px] font-bold text-white">
                  bKash
                </span>
              </div>
            </div>
            <RadioGroup
              value={payment}
              onValueChange={(v) => setPayment(v as PaymentMethod)}
              className="gap-3"
            >
              <div
                className={cn(
                  'flex items-start gap-3 rounded-xl border p-4 transition-all',
                  payment === 'COD'
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'shadow-sm hover:border-primary/40'
                )}
              >
                <RadioGroupItem value="COD" id="pay-cod" className="mt-0.5" />
                <label htmlFor="pay-cod" className="flex-1 cursor-pointer">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Banknote className="size-4 text-primary" aria-hidden="true" />
                    Cash on Delivery
                  </span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">
                    Pay when you receive your order
                  </span>
                </label>
              </div>
              <div
                className={cn(
                  'flex items-start gap-3 rounded-xl border p-4 transition-all',
                  payment === 'BKASH_DEMO'
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'shadow-sm hover:border-primary/40'
                )}
              >
                <RadioGroupItem value="BKASH_DEMO" id="pay-bkash" className="mt-0.5" />
                <label htmlFor="pay-bkash" className="flex-1 cursor-pointer">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <Smartphone className="size-4 text-primary" aria-hidden="true" />
                    bKash (Demo)
                    <span className="rounded bg-[#E2136E] px-1.5 py-0.5 text-[10px] font-bold text-white">
                      bKash
                    </span>
                  </span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">
                    Pay instantly with your bKash wallet (demo)
                  </span>
                </label>
              </div>
            </RadioGroup>
          </Card>

          {/* 4. Delivery notes (optional courier instructions) */}
          <Card className="gap-4 p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                <StickyNote className="size-5 text-primary" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h2 className="font-semibold leading-tight">Delivery notes</h2>
                <p className="text-xs text-muted-foreground">Optional instructions for our courier</p>
              </div>
            </div>
            <div className="relative">
              <Textarea
                value={notes}
                maxLength={MAX_NOTES}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Leave with the reception, call me at arrival…"
                aria-label="Delivery notes"
                className="min-h-22 resize-none pb-7 pr-10 focus-visible:ring-primary/30"
              />
              {notes.length > 0 && (
                <button
                  type="button"
                  aria-label="Clear delivery notes"
                  className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onClick={() => setNotes('')}
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              )}
              <span
                className={cn(
                  'pointer-events-none absolute bottom-2.5 right-3 text-[11px] tabular-nums',
                  notes.length > 540 ? 'font-medium text-amber-600' : 'text-muted-foreground'
                )}
                aria-live="polite"
              >
                {notes.length} / {MAX_NOTES}
              </span>
            </div>
          </Card>
        </div>

        {/* ---------- Right column: summary ---------- */}
        <Card className="sticky top-28 gap-0 p-5 shadow-sm">
          <h2 className="font-semibold">Order summary</h2>
          <Separator className="my-4" />

          <ul className="max-h-56 space-y-1 overflow-y-auto pr-1 scrollbar-thin">
            {cartItems.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-1 text-sm">
                <MedImage
                  src={i.medicine.image}
                  alt={i.medicine.name}
                  className="size-10 shrink-0 rounded-md border"
                />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-1">{i.medicine.name}</span>
                  <span className="text-xs text-muted-foreground">× {i.quantity}</span>
                </span>
                <span className="shrink-0 font-medium">
                  {fmtBDT(effectivePrice(i.medicine) * i.quantity)}
                </span>
              </li>
            ))}
          </ul>

          <Separator className="my-4" />

          {/* Coupon */}
          {coupon ? (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm">
              <span className="flex min-w-0 items-center gap-1.5 text-emerald-800">
                <Tag className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate font-semibold">{coupon.code}</span>
                <span>− {fmtBDT(coupon.discount)}</span>
              </span>
              <button
                type="button"
                aria-label="Remove coupon"
                className="flex size-6 shrink-0 items-center justify-center rounded-full text-emerald-700 hover:bg-emerald-100"
                onClick={() => setCoupon(null)}
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                value={couponInput}
                onChange={(e) => setCouponInput(e.target.value)}
                placeholder="Coupon code"
                aria-label="Coupon code"
                className="h-11 uppercase"
              />
              <Button
                variant="outline"
                className="h-11 shrink-0 rounded-xl"
                disabled={!couponInput.trim() || applyingCoupon}
                onClick={() => void applyCoupon()}
              >
                {applyingCoupon ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : 'Apply'}
              </Button>
            </div>
          )}

          <div className="mt-4 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-medium">{fmtBDT(subtotal)}</span>
            </div>
            {discount > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Discount</span>
                <span className="font-medium text-emerald-600">− {fmtBDT(discount)}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Delivery fee</span>
              {deliveryFee === 0 ? (
                <Badge className="rounded-md bg-emerald-100 text-emerald-700">FREE</Badge>
              ) : (
                <span className="font-medium">{fmtBDT(deliveryFee)}</span>
              )}
            </div>
            <Separator className="my-3" />
            <div className="flex items-center justify-between text-base">
              <span className="font-semibold">Total</span>
              <span className="font-extrabold text-primary">{fmtBDT(total)}</span>
            </div>
          </div>

          {needsRx && !rxReady && (
            <Alert className="mt-4 border-amber-300 bg-amber-50 text-amber-900">
              <FileWarning className="size-4 text-amber-600" aria-hidden="true" />
              <AlertDescription className="text-amber-800">
                Select an approved prescription or upload a new one to place your order.
              </AlertDescription>
            </Alert>
          )}
          {!selectedAddressId && (
            <p className="mt-3 text-xs font-medium text-amber-600">
              Select or add a delivery address to continue.
            </p>
          )}

          <Button
            className="mt-5 h-11 w-full rounded-xl"
            disabled={!canPlace}
            onClick={() => {
              if (payment === 'BKASH_DEMO') {
                setBkashOpen(true)
              } else {
                void placeOrder()
              }
            }}
          >
            {placing && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {placing
              ? 'Placing order…'
              : payment === 'BKASH_DEMO'
                ? `Pay ${fmtBDT(total)} with bKash`
                : 'Place order'}
          </Button>
          <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
            SSL encrypted · Demo payments — no real money moves
          </p>
        </Card>
      </div>

      {/* Add address dialog */}
      <AddressFormDialog
        open={addressDialogOpen}
        onOpenChange={setAddressDialogOpen}
        onSaved={addressSaved}
      />

      {/* bKash demo payment dialog — onPaid fires after it closes, then placeOrder() runs */}
      <BkashPayDialog
        open={bkashOpen}
        onOpenChange={setBkashOpen}
        amount={total}
        onPaid={() => void placeOrder()}
      />

      {/* Success dialog */}
      <Dialog open={!!placedOrder} onOpenChange={(open) => !open && setPlacedOrder(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <div className="mx-auto flex flex-col items-center gap-3 text-center">
              <CheckCircle2 className="size-16 text-emerald-500" aria-hidden="true" />
              <DialogTitle className="text-xl">Order placed successfully!</DialogTitle>
              <DialogDescription>
                Order no: <span className="font-mono font-semibold text-foreground">{placedOrder?.orderNo}</span>
              </DialogDescription>
              {needsRx && placedOrder && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Your prescription will be reviewed by a licensed pharmacist before dispatch.
                </p>
              )}
            </div>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Button
              className="h-11 w-full rounded-xl"
              onClick={() => {
                setPlacedOrder(null)
                setView('orders')
              }}
            >
              Track my order
            </Button>
            <Button
              variant="outline"
              className="h-11 w-full rounded-xl"
              onClick={() => {
                setPlacedOrder(null)
                setView('home')
              }}
            >
              Continue shopping
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
