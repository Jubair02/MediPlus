'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BadgeCheck,
  Inbox,
  Loader2,
  MessageCircleQuestion,
  Pencil,
  RefreshCw,
  RotateCcw,
  ThumbsUp,
  X,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { PharmacistQuestion, QuestionCounts, QuestionStatus } from '@/lib/types'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import MedImage from './MedImage'

const ANSWER_MIN = 2
const ANSWER_MAX = 1000

/** Round 9: helpful votes ride along on pharmacist question rows (9-a backend). */
type HelpfulQuestion = PharmacistQuestion & { helpfulCount?: number }

const FILTERS: {
  key: QuestionStatus
  label: string
  active: string
  count: string
}[] = [
  {
    key: 'PENDING',
    label: 'Pending',
    active: 'border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-200',
    count: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  },
  {
    key: 'ANSWERED',
    label: 'Answered',
    active:
      'border-emerald-300 bg-emerald-100 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-200',
    count: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
  },
  {
    key: 'REJECTED',
    label: 'Rejected',
    active: 'border-border bg-muted text-foreground',
    count: 'bg-red-500/10 text-red-700 dark:text-red-400',
  },
]

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const mins = Math.max(0, Math.floor((Date.now() - t) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return fmtDate(iso)
}

function QuestionCardSkeleton() {
  return (
    <Card className="gap-0 p-0" aria-hidden="true">
      <CardContent className="space-y-3 p-4">
        <div className="flex gap-3">
          <Skeleton className="h-11 w-11 rounded-lg" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-14 w-full rounded-r-md" />
      </CardContent>
    </Card>
  )
}

interface PharmacistQAProps {
  /** Push fresh global counts up so the sidebar badge stays in sync. */
  onCountsChanged?: (counts: QuestionCounts) => void
}

export default function PharmacistQA({ onCountsChanged }: PharmacistQAProps) {
  const [status, setStatus] = useState<QuestionStatus>('PENDING')
  const [list, setList] = useState<HelpfulQuestion[]>([])
  const [counts, setCounts] = useState<QuestionCounts | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [rejectTarget, setRejectTarget] = useState<PharmacistQuestion | null>(null)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const countsRef = useRef(onCountsChanged)
  countsRef.current = onCountsChanged

  const load = useCallback(async (filter: QuestionStatus, silent = false) => {
    if (silent) setRefreshing(true)
    else {
      setLoading(true)
      setError(null)
    }
    try {
      const d = await api<{ questions: HelpfulQuestion[]; counts: QuestionCounts }>(
        `/api/pharmacist?resource=questions&status=${filter}`
      )
      setList(d.questions)
      setCounts(d.counts)
      countsRef.current?.(d.counts)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load questions'
      if (silent) toast.error(message)
      else setError(message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load(status)
  }, [load, status])

  function startAnswer(q: PharmacistQuestion, restoring = false) {
    setEditingId(q.id)
    setRestoringId(restoring ? q.id : null)
    setDraft(q.answer ?? '')
  }

  function cancelEditing() {
    setEditingId(null)
    setRestoringId(null)
    setDraft('')
  }

  /** Optimistically swap a mutated question; drop it if it left the current filter. */
  function applyUpdate(updated: PharmacistQuestion) {
    setList((prev) => {
      const next = updated.status === status ? prev.map((q) => (q.id === updated.id ? updated : q)) : prev.filter((q) => q.id !== updated.id)
      return next
    })
  }

  async function publish(q: PharmacistQuestion) {
    const answer = draft.trim()
    if (answer.length < ANSWER_MIN) {
      toast.error(`Answer must be at least ${ANSWER_MIN} characters`)
      return
    }
    setSavingId(q.id)
    try {
      const d = await api<{ question: PharmacistQuestion }>('/api/pharmacist', {
        method: 'PUT',
        body: { action: 'answer', id: q.id, answer },
      })
      applyUpdate(d.question)
      toast.success(q.status === 'REJECTED' ? 'Question restored with your answer' : 'Answer published')
      cancelEditing()
      void load(status, true) // refresh counts + list in the background
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to publish answer')
    } finally {
      setSavingId(null)
    }
  }

  async function reject(q: PharmacistQuestion) {
    setSavingId(q.id)
    try {
      const d = await api<{ question: PharmacistQuestion }>('/api/pharmacist', {
        method: 'PUT',
        body: { action: 'reject', id: q.id },
      })
      applyUpdate(d.question)
      toast.success('Question rejected — it stays hidden from customers')
      setRejectTarget(null)
      void load(status, true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to reject question')
      setRejectTarget(null)
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* Toolbar: segmented status filter + refresh */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="radiogroup"
          aria-label="Filter questions by status"
          className="flex flex-wrap items-center gap-1.5"
        >
          {FILTERS.map((f) => {
            const active = status === f.key
            const n = counts?.[f.key]
            return (
              <button
                key={f.key}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setStatus(f.key)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                  active
                    ? f.active
                    : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                {f.label}
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                    active ? f.count : 'bg-muted text-muted-foreground'
                  )}
                >
                  {n ?? '–'}
                </span>
              </button>
            )
          })}
        </div>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => void load(status)}
          disabled={refreshing}
          aria-label="Refresh questions"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
        </Button>
      </div>

      {/* Error state */}
      {error ? (
        <Card className="flex-col items-center gap-2 p-10 text-center">
          <MessageCircleQuestion className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void load(status)}>
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </Button>
        </Card>
      ) : loading ? (
        <div className="space-y-3" aria-hidden="true">
          <QuestionCardSkeleton />
          <QuestionCardSkeleton />
          <QuestionCardSkeleton />
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-12 text-center">
          <Inbox className="h-10 w-10 text-muted-foreground/50" />
          <p className="font-medium">
            {status === 'PENDING'
              ? 'Inbox zero'
              : status === 'ANSWERED'
                ? 'No answered questions'
                : 'No rejected questions'}
          </p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {status === 'PENDING'
              ? 'No customer questions are waiting. New ones will land here the moment they arrive.'
              : status === 'ANSWERED'
                ? 'Answers you publish will show up in this bucket.'
                : 'Questions you reject are kept here — customers never see them.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((q) => {
            const isEditing = editingId === q.id
            const isSaving = savingId === q.id
            const helpful = q.helpfulCount ?? 0
            return (
              <Card key={q.id} className="gap-0 p-0 transition-shadow hover:shadow-sm">
                <CardContent className="space-y-3 p-4">
                  {/* Medicine + asker header */}
                  <div className="flex gap-3">
                    <MedImage
                      src={q.medicineImage}
                      alt={q.medicineName}
                      className="h-11 w-11 shrink-0 rounded-lg border object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-x-2">
                        <p className="truncate text-sm font-medium">{q.medicineName}</p>
                        <div className="flex items-center gap-1.5">
                          {q.status === 'ANSWERED' && helpful > 0 && (
                            <span
                              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                              title={`${helpful} customers found this helpful`}
                              aria-label={`${helpful} customers found this helpful`}
                            >
                              <ThumbsUp className="h-3 w-3" aria-hidden="true" />
                              <span className="tabular-nums">{helpful}</span>
                            </span>
                          )}
                          {q.status === 'REJECTED' && (
                            <Badge
                              variant="outline"
                              className="border-gray-300 bg-gray-100 text-gray-600"
                            >
                              Rejected
                            </Badge>
                          )}
                        </div>
                      </div>
                      <p
                        className="text-xs text-muted-foreground"
                        title={`Asked ${fmtDateTime(q.createdAt)}`}
                      >
                        {q.askedByName} · {timeAgo(q.createdAt)}
                      </p>
                    </div>
                  </div>

                  {/* Customer question — quoted */}
                  <blockquote className="border-l-2 border-primary/40 pl-3 text-sm italic text-foreground/90">
                    “{q.question}”
                  </blockquote>

                  {/* Existing answer */}
                  {q.status === 'ANSWERED' && q.answer && !isEditing && (
                    <>
                      <div className="rounded-r-md border-l-2 border-emerald-500 bg-emerald-50/70 p-3 dark:bg-emerald-950/25">
                        <p className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                          <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                          {q.answerByName ?? 'Pharmacist'}
                          {q.answeredAt && (
                            <span
                              className="font-normal text-emerald-600/80 dark:text-emerald-400/70"
                              title={fmtDateTime(q.answeredAt)}
                            >
                              · answered {timeAgo(q.answeredAt)}
                            </span>
                          )}
                        </p>
                        <p className="mt-1 text-sm text-emerald-950 dark:text-emerald-50">{q.answer}</p>
                      </div>
                      <div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-muted-foreground"
                          onClick={() => startAnswer(q)}
                          aria-label={`Edit your answer to the question about ${q.medicineName}`}
                        >
                          <Pencil className="h-3.5 w-3.5" /> Edit answer
                        </Button>
                      </div>
                    </>
                  )}

                  {/* Rejected actions */}
                  {q.status === 'REJECTED' && !isEditing && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-muted-foreground"
                        onClick={() => startAnswer(q, true)}
                        aria-label={`Restore the rejected question about ${q.medicineName} by answering`}
                      >
                        <RotateCcw className="h-3.5 w-3.5" /> Restore by answering
                      </Button>
                      <span className="text-[11px] text-muted-foreground">
                        Rejected questions stay hidden — publishing an answer restores visibility.
                      </span>
                    </div>
                  )}

                  {/* Answer composer (pending, edit, or restore) */}
                  {(q.status === 'PENDING' || isEditing) && (
                    <div className="space-y-2">
                      {q.status === 'REJECTED' && isEditing && (
                        <p className="text-xs text-muted-foreground">
                          Restoring this question publishes your answer and makes it visible to
                          customers again.
                        </p>
                      )}
                      <Textarea
                        rows={3}
                        value={draft}
                        maxLength={ANSWER_MAX}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder={
                          q.answer ?? 'Write a helpful, accurate answer for the customer…'
                        }
                        aria-label={`Answer text for the question about ${q.medicineName}`}
                      />
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[11px] tabular-nums text-muted-foreground">
                          {draft.trim().length}/{ANSWER_MAX} chars (min {ANSWER_MIN})
                        </span>
                        <div className="flex items-center gap-2">
                          {q.status === 'PENDING' && (
                            <Button
                              variant="ghost"
                              className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40"
                              size="sm"
                              disabled={isSaving}
                              onClick={() => setRejectTarget(q)}
                              aria-label={`Reject the question about ${q.medicineName}`}
                            >
                              {isSaving ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <XCircle className="h-4 w-4" />
                              )}
                              Reject
                            </Button>
                          )}
                          {isEditing && (
                            <Button variant="ghost" size="sm" onClick={cancelEditing} disabled={isSaving}>
                              <X className="h-4 w-4" /> Cancel
                            </Button>
                          )}
                          <Button
                            size="sm"
                            className="bg-emerald-600 text-white hover:bg-emerald-700"
                            disabled={draft.trim().length < ANSWER_MIN || isSaving}
                            onClick={() => void publish(q)}
                            aria-label={`Publish answer to the question about ${q.medicineName}`}
                          >
                            {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                            {q.status === 'REJECTED' ? 'Publish & restore' : 'Publish answer'}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Reject confirm */}
      <AlertDialog
        open={rejectTarget !== null}
        onOpenChange={(o) => !o && setRejectTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject this question?</AlertDialogTitle>
            <AlertDialogDescription>
              Rejected questions are never shown to customers and cannot be answered unless
              restored. The asker keeps their question in their own history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={savingId !== null}
              onClick={(e) => {
                e.preventDefault()
                if (rejectTarget) void reject(rejectTarget)
              }}
            >
              {savingId !== null && <Loader2 className="h-4 w-4 animate-spin" />}
              Reject question
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
