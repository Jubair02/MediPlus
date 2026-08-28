'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { BadgeCheck, Loader2, LogIn, Star, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { fmtDate } from '@/lib/format'
import type { Review, ReviewSummary } from '@/lib/types'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

const MAX_COMMENT = 600

interface ReviewsPayload {
  summary: ReviewSummary
  reviews: Review[]
}

/** 5 full/empty amber stars — used for the summary + review rows */
function StarRow({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)} aria-label={`${Math.round(value)} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={cn(
            'size-3.5',
            i < Math.round(value) ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground'
          )}
          aria-hidden="true"
        />
      ))}
    </span>
  )
}

/** Summary (avg + distribution bars) with loading skeleton */
function SummaryBlock({ summary, loading }: { summary: ReviewSummary | null; loading: boolean }) {
  if (loading || !summary) {
    return (
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-8">
        <div className="flex shrink-0 flex-col items-center gap-1.5">
          <Skeleton className="h-10 w-16" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-28" />
        </div>
        <div className="flex-1 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <Skeleton className="h-3 w-8" />
              <Skeleton className="h-2 flex-1" />
              <Skeleton className="h-3 w-6" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  const total = summary.count
  const rows = [...summary.distribution].sort((a, b) => b.rating - a.rating)
  const maxCount = Math.max(...rows.map((d) => d.count), 1)

  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-8">
      <div className="flex shrink-0 flex-col items-center gap-1.5">
        <p className="text-3xl font-bold leading-none">{summary.count > 0 ? summary.avg.toFixed(1) : '—'}</p>
        {summary.count > 0 && <StarRow value={summary.avg} />}
        <p className="text-xs text-muted-foreground">
          {summary.count > 0
            ? `Based on ${summary.count} review${summary.count === 1 ? '' : 's'}`
            : 'No reviews yet'}
        </p>
      </div>

      <div className="min-w-0 flex-1 space-y-1.5" aria-label="Rating distribution">
        {rows.map((d) => {
          const pct = d.count > 0 ? Math.round((d.count / maxCount) * 100) : 0
          return (
            <div key={d.rating} className="flex items-center gap-2">
              <span className="inline-flex w-9 shrink-0 items-center justify-end gap-0.5 text-xs text-muted-foreground">
                {d.rating}
                <Star className="size-3 fill-amber-400 text-amber-400" aria-hidden="true" />
              </span>
              <div
                className="h-2 flex-1 overflow-hidden rounded bg-muted"
                role="img"
                aria-label={`${d.rating} star: ${pct}%`}
              >
                <div
                  className="h-full rounded bg-emerald-500 transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {d.count}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Interactive 5-star picker with tap animation + hover preview */
function StarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [hover, setHover] = useState(0)
  const shown = hover || value

  return (
    <div className="flex items-center gap-1" onMouseLeave={() => setHover(0)}>
      {Array.from({ length: 5 }).map((_, i) => {
        const n = i + 1
        return (
          <motion.button
            key={n}
            type="button"
            aria-label={`Rate ${n} ${n === 1 ? 'star' : 'stars'}`}
            aria-pressed={value === n}
            className="flex size-9 items-center justify-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
            whileHover={{ scale: 1.18 }}
            whileTap={{ scale: 0.82 }}
            onMouseEnter={() => setHover(n)}
            onClick={() => onChange(n)}
          >
            <Star
              className={cn(
                'size-6 transition-colors',
                n <= shown ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground'
              )}
              aria-hidden="true"
            />
          </motion.button>
        )
      })}
      <span className="ml-1 text-sm font-medium tabular-nums" aria-live="polite">
        {value > 0 ? `${value}/5` : ''}
      </span>
    </div>
  )
}

/** Write / update / delete form (signed-in users only). Keyed by review id upstream. */
function ReviewForm({
  medicineId,
  review,
  onSaved,
}: {
  medicineId: string
  review: Review | null
  onSaved: () => void
}) {
  const [stars, setStars] = useState(review?.rating ?? 0)
  const [comment, setComment] = useState(review?.comment ?? '')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const submit = async () => {
    if (stars < 1) {
      toast.error('Please select a star rating')
      return
    }
    setSaving(true)
    try {
      await api<Review>('/api/reviews', {
        method: 'POST',
        body: { medicineId, rating: stars, comment: comment.trim() || undefined },
      })
      toast.success(review ? 'Your review has been updated' : 'Thanks! Your review has been posted')
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit review')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!review) return
    setDeleting(true)
    try {
      await api<{ ok: boolean }>(`/api/reviews?id=${encodeURIComponent(review.id)}`, { method: 'DELETE' })
      toast.success('Your review was deleted')
      setDeleteOpen(false)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete review')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="rounded-xl border bg-card/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">{review ? 'Update your review' : 'Write a review'}</p>
        {review && (
          <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={deleting || saving}
                className="h-8 gap-1.5 rounded-lg border-red-200 text-red-600 hover:bg-red-50 hover:text-red-600 dark:border-red-900 dark:hover:bg-red-950"
              >
                {deleting ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Trash2 className="size-3.5" aria-hidden="true" />
                )}
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete your review?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will remove your rating and comment for this medicine. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="h-11 rounded-xl">Keep review</AlertDialogCancel>
                <AlertDialogAction
                  className="h-11 rounded-xl bg-red-600 text-white hover:bg-red-700"
                  disabled={deleting}
                  onClick={(e) => {
                    e.preventDefault()
                    void remove()
                  }}
                >
                  {deleting ? 'Deleting…' : 'Yes, delete'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      <div className="mt-3">
        <StarPicker value={stars} onChange={setStars} />
      </div>

      <div className="mt-3 space-y-1.5">
        <Textarea
          value={comment}
          maxLength={MAX_COMMENT}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Share your experience with this medicine…"
          aria-label="Your review"
          className="min-h-20 resize-none"
        />
        <p className="text-right text-[11px] tabular-nums text-muted-foreground">
          {comment.length}/{MAX_COMMENT}
        </p>
      </div>

      <Button className="h-11 w-full rounded-xl sm:w-auto sm:px-8" disabled={saving || deleting} onClick={() => void submit()}>
        {saving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        {saving ? 'Saving…' : review ? 'Update review' : 'Submit review'}
      </Button>
    </div>
  )
}

/** Compact sign-in prompt shown to guests */
function GuestCard() {
  const setAuthOpen = useAppStore((s) => s.setAuthOpen)
  return (
    <Card className="flex-col items-center gap-3 border-dashed p-5 text-center sm:flex-row sm:text-left">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <LogIn className="size-5 text-primary" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Sign in to review this medicine</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Share your experience and help other customers.
        </p>
      </div>
      <Button className="h-11 shrink-0 rounded-xl" onClick={() => setAuthOpen(true)}>
        Sign in
      </Button>
    </Card>
  )
}

/** Full ratings & reviews module — used inside MedicineDetailModal */
export default function ReviewsSection({ medicineId }: { medicineId: string }) {
  const user = useAppStore((s) => s.user)
  const [data, setData] = useState<ReviewsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const ac = new AbortController()
    api<ReviewsPayload>(`/api/reviews?medicineId=${encodeURIComponent(medicineId)}`, { signal: ac.signal })
      .then((d) => {
        if (ac.signal.aborted) return
        setData(d)
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

  const reload = () => setReloadKey((k) => k + 1)

  const myReview = user ? (data?.reviews.find((r) => r.user?.id === user.id) ?? null) : null

  return (
    <section aria-label="Ratings and reviews" className="space-y-4">
      <h3 className="text-base font-bold tracking-tight">Ratings &amp; reviews</h3>

      {failed && !loading ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load reviews.</p>
          <Button variant="outline" size="sm" className="h-9 rounded-lg" onClick={reload}>
            Try again
          </Button>
        </div>
      ) : (
        <SummaryBlock summary={data?.summary ?? null} loading={loading} />
      )}

      {/* Reviews list */}
      {!loading && !failed && (
        <>
          {data && data.reviews.length > 0 ? (
            <div className="max-h-80 space-y-3 overflow-y-auto pr-1 scrollbar-thin">
              {data.reviews.map((r, i) => (
                <motion.div
                  key={r.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: Math.min(i * 0.04, 0.3), ease: 'easeOut' }}
                  className="rounded-xl border p-3"
                >
                  <div className="flex items-start gap-3">
                    <Avatar className="size-9 border">
                      <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">
                        {(r.user?.name?.[0] ?? 'A').toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <p className="text-sm font-medium">{r.user?.name ?? 'Anonymous'}</p>
                        {r.verified && (
                          <span
                            className="inline-flex items-center gap-0.5 text-[11px] font-medium text-emerald-600"
                            title="Ordered & delivered via MediPlus"
                          >
                            <BadgeCheck className="size-3.5" aria-hidden="true" />
                            Verified purchase
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <StarRow value={r.rating} />
                        <span className="text-[11px] text-muted-foreground">{fmtDate(r.createdAt)}</span>
                      </div>
                      {r.comment && (
                        <p className="mt-1.5 text-sm text-muted-foreground">{r.comment}</p>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
              No written reviews yet — be the first to share your experience.
            </p>
          )}
        </>
      )}

      {/* Write / guest area */}
      {user ? (
        <ReviewForm key={myReview?.id ?? 'new'} medicineId={medicineId} review={myReview} onSaved={reload} />
      ) : (
        <GuestCard />
      )}
    </section>
  )
}
