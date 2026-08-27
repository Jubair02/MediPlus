'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  BadgeCheck,
  CalendarClock,
  Clock3,
  FileWarning,
  Loader2,
  MessageCircleQuestion,
  MessageSquarePlus,
  Minus,
  Package,
  Plus,
  ShoppingCart,
  Tags,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { effectivePrice, fmtBDT, fmtDate, stockLabel } from '@/lib/format'
import type { Medicine, MedicineQA } from '@/lib/types'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { MedImage, addToCart } from '@/components/store/MedicineCard'
import ReviewsSection from '@/components/store/ReviewsSection'
import { cn } from '@/lib/utils'

const stockToneClass: Record<string, string> = {
  in: 'text-emerald-600',
  low: 'text-amber-600',
  out: 'text-red-600',
}

const MIN_QUESTION = 5
const MAX_QUESTION = 600

/** Compact relative time for Q&A meta lines ("3 days ago") */
function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo} month${mo === 1 ? '' : 's'} ago`
  const y = Math.floor(mo / 12)
  return `${y} year${y === 1 ? '' : 's'} ago`
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

  // Freshness chip: reassure customers about shelf life (emerald ≥ 6 months, amber 3–6, red < 3)
  let expiryChip: { label: string; className: string; title: string } | null = null
  if (m.expiryDate) {
    const days = Math.ceil((new Date(m.expiryDate).getTime() - Date.now()) / 86_400_000)
    const months = Math.max(0, Math.round(days / 30))
    if (days < 0) {
      expiryChip = { label: 'Expired', className: 'bg-red-100 text-red-700', title: 'This batch has expired' }
    } else if (days < 90) {
      expiryChip = { label: 'Expires soon', className: 'bg-red-100 text-red-700', title: 'Less than 3 months shelf life left' }
    } else if (days < 180) {
      expiryChip = { label: `${months} months left`, className: 'bg-amber-100 text-amber-700', title: 'Short-dated batch — discounted freshness' }
    } else {
      expiryChip = { label: `${months} months left`, className: 'bg-emerald-100 text-emerald-700', title: 'Plenty of shelf life' }
    }
  }

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
            <span className="flex items-center gap-1.5">
              <span className="font-medium">{fmtDate(m.expiryDate)}</span>
              {expiryChip && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${expiryChip.className}`}
                  title={expiryChip.title}
                >
                  {expiryChip.label}
                </span>
              )}
            </span>
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

/**
 * Product Q&A — public answered threads (chat bubbles) + the viewer's own
 * pending questions. Guests are prompted to sign in before asking.
 */
function QASection({ medicineId }: { medicineId: string }) {
  const user = useAppStore((s) => s.user)
  const setAuthOpen = useAppStore((s) => s.setAuthOpen)
  const [questions, setQuestions] = useState<MedicineQA[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  // Auth OPTIONAL on this GET — sending the token also surfaces own PENDING rows
  useEffect(() => {
    const ac = new AbortController()
    api<{ questions: MedicineQA[] }>(
      `/api/questions?medicineId=${encodeURIComponent(medicineId)}`,
      { signal: ac.signal }
    )
      .then((d) => {
        if (ac.signal.aborted) return
        setQuestions(d.questions)
        setFailed(false)
      })
      .catch((err) => {
        if (ac.signal.aborted) return
        setFailed(err instanceof Error)
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false)
      })
    return () => ac.abort()
  }, [medicineId, user?.id, reloadKey])

  const answered = (questions ?? []).filter((q) => q.status === 'ANSWERED')
  const pendingMine = (questions ?? []).filter((q) => q.status === 'PENDING')
  const draftLen = draft.trim().length
  const canSubmit = draftLen >= MIN_QUESTION && draftLen <= MAX_QUESTION && !submitting

  const submitQuestion = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const d = await api<{ question: MedicineQA }>('/api/questions', {
        method: 'POST',
        body: { medicineId, question: draft.trim() },
      })
      setQuestions((prev) => [d.question, ...(prev ?? [])])
      setComposerOpen(false)
      setDraft('')
      toast.success('Question submitted — our pharmacist will answer soon')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit question')
    } finally {
      setSubmitting(false)
    }
  }

  const onAskClick = () => {
    if (!user) {
      setAuthOpen(true)
      return
    }
    setComposerOpen((o) => !o)
  }

  return (
    <section aria-label="Questions and answers" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 text-base font-bold tracking-tight">
          <MessageCircleQuestion className="size-5 text-primary" aria-hidden="true" />
          Questions &amp; answers
          {answered.length > 0 && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
              {answered.length}
            </span>
          )}
        </h3>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto h-9 gap-1.5 rounded-lg"
          onClick={onAskClick}
        >
          <MessageSquarePlus className="size-4" aria-hidden="true" />
          Ask a question
        </Button>
      </div>

      {loading ? (
        /* 2 gray bubble rows while fetching */
        <div className="space-y-3" aria-hidden="true">
          {[0, 1].map((i) => (
            <div key={i} className="space-y-2">
              <div className="flex items-start gap-2.5">
                <Skeleton className="size-7 shrink-0 rounded-lg" />
                <Skeleton className={cn('flex-1 rounded-xl', i === 0 ? 'h-9' : 'h-7')} />
              </div>
              <div className="flex items-start gap-2.5 pl-9">
                <Skeleton className="size-7 shrink-0 rounded-lg" />
                <Skeleton className="h-12 flex-1 rounded-xl" />
              </div>
            </div>
          ))}
        </div>
      ) : failed ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load questions.</p>
          <Button
            variant="outline"
            size="sm"
            className="h-9 rounded-lg"
            onClick={() => {
              setLoading(true)
              setReloadKey((k) => k + 1)
            }}
          >
            Try again
          </Button>
        </div>
      ) : (
        <>
          {/* Own pending questions */}
          {pendingMine.length > 0 && (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                <Clock3 className="size-3.5" aria-hidden="true" />
                Your question (pending review)
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                  Awaiting answer
                </span>
              </p>
              {pendingMine.map((q, i) => (
                <motion.div
                  key={q.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: Math.min(i * 0.04, 0.2), ease: 'easeOut' }}
                  className="rounded-xl border border-dashed border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900/70 dark:bg-amber-950/20"
                >
                  <p className="text-sm leading-snug text-muted-foreground">{q.question}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {q.askedByName} · {timeAgo(q.createdAt)}
                  </p>
                </motion.div>
              ))}
            </div>
          )}

          {/* Answered threads */}
          {answered.length > 0 ? (
            <div
              className={cn(
                'space-y-4',
                answered.length > 4 && 'max-h-80 overflow-y-auto pr-1 scrollbar-thin'
              )}
            >
              {answered.map((q, i) => (
                <motion.div
                  key={q.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: Math.min(i * 0.05, 0.3), ease: 'easeOut' }}
                  className="space-y-2"
                >
                  {/* Question row */}
                  <div className="flex items-start gap-2.5">
                    <span
                      className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-xs font-bold text-amber-700 dark:text-amber-400"
                      aria-hidden="true"
                    >
                      Q
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-snug">{q.question}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {q.askedByName} · {timeAgo(q.createdAt)}
                      </p>
                    </div>
                  </div>
                  {/* Answer row — indented, pharmacist chip */}
                  {q.answer && (
                    <div className="flex items-start gap-2.5 pl-9">
                      <span
                        className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-xs font-bold text-primary"
                        aria-hidden="true"
                      >
                        A
                      </span>
                      <div className="min-w-0 flex-1 rounded-xl rounded-tl-sm border bg-card/60 p-3">
                        <p className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary">
                          <BadgeCheck className="size-3.5" aria-hidden="true" />
                          {q.answerByName ?? 'Pharmacist'}
                        </p>
                        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{q.answer}</p>
                      </div>
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          ) : (
            pendingMine.length === 0 && (
              <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed p-6 text-center">
                <span className="flex size-11 items-center justify-center rounded-full bg-primary/10">
                  <MessageCircleQuestion className="size-5 text-primary" aria-hidden="true" />
                </span>
                <p className="text-sm font-semibold">No questions yet</p>
                <p className="text-xs text-muted-foreground">
                  Be the first to ask about this medicine.
                </p>
              </div>
            )
          )}

          {/* Inline composer (signed-in only — guests get the auth modal) */}
          {composerOpen && user && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="rounded-xl border bg-card/50 p-3"
            >
              <Textarea
                value={draft}
                maxLength={MAX_QUESTION}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Ask about dosage, usage, interactions…"
                aria-label="Your question"
                className="min-h-20 resize-none focus-visible:ring-primary/30"
              />
              {draftLen > 0 && draftLen < MIN_QUESTION && (
                <p className="mt-1 text-[11px] text-amber-600">
                  Question must be at least {MIN_QUESTION} characters.
                </p>
              )}
              <div className="mt-2 flex items-center justify-between gap-2">
                <span
                  className={cn(
                    'text-[11px] tabular-nums',
                    draftLen > 540 ? 'font-medium text-amber-600' : 'text-muted-foreground'
                  )}
                  aria-live="polite"
                >
                  {draft.length} / {MAX_QUESTION}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9 rounded-lg"
                    disabled={submitting}
                    onClick={() => {
                      setComposerOpen(false)
                      setDraft('')
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="h-9 gap-1.5 rounded-lg"
                    disabled={!canSubmit}
                    onClick={() => void submitQuestion()}
                  >
                    {submitting && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
                    {submitting ? 'Submitting…' : 'Submit question'}
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </>
      )}
    </section>
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
        {/* Ratings & reviews — full width under the detail body */}
        <div className="mt-4 border-t px-4 pb-6 pt-4 sm:px-6">
          <ReviewsSection medicineId={medicine.id} />
        </div>
        {/* Questions & answers — below reviews, inside the same scroll area */}
        <div className="border-t px-4 pb-6 pt-4 sm:px-6">
          <QASection medicineId={medicine.id} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
