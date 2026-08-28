'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Clock, FileCheck, Loader2, Mail, Phone, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { fmtDate, fmtDateTime } from '@/lib/format'
import type { Prescription } from '@/lib/types'
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import MedImage from './MedImage'

const RX_STATUS_TONES: Record<Prescription['status'], string> = {
  PENDING: 'bg-amber-100 text-amber-800 border-amber-300',
  APPROVED: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  REJECTED: 'bg-red-100 text-red-800 border-red-300',
}

function RxStatusBadge({ status }: { status: Prescription['status'] }) {
  return (
    <Badge
      variant={status === 'PENDING' ? 'outline' : 'default'}
      className={`border ${RX_STATUS_TONES[status]}`}
    >
      {status}
    </Badge>
  )
}

/** Round 10 — approval validity chip (APPROVED rows; fields may be absent on stale responses). */
function RxExpiryChip({ rx }: { rx: Prescription }) {
  const daysLeft = rx.daysLeft ?? null
  if (rx.status !== 'APPROVED' || daysLeft === null) return null
  if (daysLeft <= 0) {
    return (
      <Badge
        variant="outline"
        className="border border-red-300 bg-red-100 text-red-800 dark:text-red-300"
        title={rx.expiresAt ? `Expired on ${fmtDate(rx.expiresAt)}` : undefined}
      >
        Expired
      </Badge>
    )
  }
  if (daysLeft <= 7) {
    return (
      <Badge variant="outline" className="border border-red-300 bg-red-100 text-red-800 dark:text-red-300">
        Expires in {daysLeft}d
      </Badge>
    )
  }
  if (daysLeft <= 14) {
    return (
      <Badge
        variant="outline"
        className="border border-amber-300 bg-amber-100 text-amber-800 dark:text-amber-300"
      >
        Expires in {daysLeft}d
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="border-muted bg-muted text-muted-foreground">
      Valid {daysLeft}d
    </Badge>
  )
}

type TabKey = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL'

export default function PharmacistPrescriptions({ onStatsChanged }: { onStatsChanged?: () => void }) {
  const [list, setList] = useState<Prescription[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<TabKey>('PENDING')
  const [selected, setSelected] = useState<Prescription | null>(null)
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [rejectConfirm, setRejectConfirm] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await api<{ prescriptions: Prescription[] }>('/api/pharmacist?resource=prescriptions')
      setList(d.prescriptions)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load prescriptions')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (selected) setNote('')
  }, [selected])

  const counts = useMemo(
    () => ({
      PENDING: list.filter((p) => p.status === 'PENDING').length,
      APPROVED: list.filter((p) => p.status === 'APPROVED').length,
      REJECTED: list.filter((p) => p.status === 'REJECTED').length,
      ALL: list.length,
    }),
    [list]
  )

  const filtered = useMemo(
    () => (tab === 'ALL' ? list : list.filter((p) => p.status === tab)),
    [list, tab]
  )

  function updateLocal(id: string, status: Prescription['status'], reviewNote: string | null) {
    setList((prev) =>
      prev.map((p) =>
        p.id === id
          ? { ...p, status, reviewNote: reviewNote ?? p.reviewNote }
          : p
      )
    )
  }

  async function review(decision: 'APPROVED' | 'REJECTED') {
    if (!selected) return
    if (decision === 'REJECTED' && !note.trim()) {
      toast.error('A review note is required when rejecting a prescription')
      return
    }
    setPending(true)
    try {
      await api<{ prescription: Prescription }>('/api/pharmacist', {
        method: 'PUT',
        body: {
          action: 'review',
          prescriptionId: selected.id,
          decision,
          reviewNote: note.trim() || undefined,
        },
      })
      updateLocal(selected.id, decision, note.trim() || null)
      toast.success(decision === 'APPROVED' ? 'Prescription approved' : 'Prescription rejected')
      setSelected(null)
      setRejectConfirm(false)
      onStatsChanged?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to submit review')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList className="grid w-full max-w-lg grid-cols-4">
          <TabsTrigger value="PENDING" className="text-xs sm:text-sm">
            Pending ({counts.PENDING})
          </TabsTrigger>
          <TabsTrigger value="APPROVED" className="text-xs sm:text-sm">
            Approved ({counts.APPROVED})
          </TabsTrigger>
          <TabsTrigger value="REJECTED" className="text-xs sm:text-sm">
            Rejected ({counts.REJECTED})
          </TabsTrigger>
          <TabsTrigger value="ALL" className="text-xs sm:text-sm">
            All ({counts.ALL})
          </TabsTrigger>
        </TabsList>

        {[...(['PENDING', 'APPROVED', 'REJECTED', 'ALL'] as TabKey[])].map((key) => (
          <TabsContent key={key} value={key} className="mt-4">
            {loading ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[...Array(6)].map((_, i) => (
                  <Skeleton key={i} className="h-64 w-full rounded-xl" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-12 text-center">
                <FileCheck className="h-10 w-10 text-muted-foreground/50" />
                <p className="font-medium">Nothing here</p>
                <p className="text-sm text-muted-foreground">
                  {key === 'PENDING'
                    ? 'No prescriptions waiting for review.'
                    : 'No prescriptions in this bucket yet.'}
                </p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filtered.map((p) => (
                  <Card
                    key={p.id}
                    className="cursor-pointer gap-0 overflow-hidden p-0 transition-shadow hover:shadow-md"
                    onClick={() => setSelected(p)}
                  >
                    <MedImage
                      src={p.image}
                      alt={`Prescription from ${p.user?.name ?? 'customer'}`}
                      className="h-28 w-full object-cover"
                    />
                    <CardContent className="space-y-2 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="min-w-0 truncate text-sm font-semibold">
                          {p.user?.name ?? 'Unknown patient'}
                        </p>
                        <RxStatusBadge status={p.status} />
                      </div>
                      <div className="space-y-0.5 text-xs text-muted-foreground">
                        <p className="flex items-center gap-1.5">
                          <Mail className="h-3 w-3" /> <span className="truncate">{p.user?.email}</span>
                        </p>
                        {p.user?.phone && (
                          <p className="flex items-center gap-1.5">
                            <Phone className="h-3 w-3" /> {p.user.phone}
                          </p>
                        )}
                      </div>
                      {p.note && <p className="line-clamp-2 text-xs text-muted-foreground">{p.note}</p>}
                      {p.status === 'APPROVED' && p.expiresAt && (
                        <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Clock className="size-3.5" aria-hidden="true" />
                          Valid until {fmtDate(p.expiresAt)}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {p.orderNo && (
                          <Badge variant="secondary" className="font-mono text-[10px]">
                            {p.orderNo}
                          </Badge>
                        )}
                        <RxExpiryChip rx={p} />
                        <span className="text-[11px] text-muted-foreground">
                          {fmtDateTime(p.createdAt)}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>

      {/* Review dialog */}
      <Dialog open={selected !== null} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto scrollbar-thin sm:max-w-xl">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>Prescription review</DialogTitle>
                <DialogDescription>
                  Uploaded {fmtDateTime(selected.createdAt)} · <RxStatusBadge status={selected.status} />
                </DialogDescription>
              </DialogHeader>

              <MedImage
                src={selected.image}
                alt="Prescription"
                className="max-h-[65vh] w-full rounded-lg border object-contain"
              />

              {/* Patient info */}
              <div className="grid gap-2 rounded-lg border p-3 text-sm sm:grid-cols-2">
                <p className="font-medium">{selected.user?.name ?? 'Unknown patient'}</p>
                <p className="text-muted-foreground">{selected.user?.email}</p>
                {selected.user?.phone && (
                  <p className="text-muted-foreground">{selected.user.phone}</p>
                )}
                {selected.orderNo && (
                  <p className="text-muted-foreground">
                    Linked order:{' '}
                    <Badge variant="secondary" className="font-mono text-[10px]">
                      {selected.orderNo}
                    </Badge>
                  </p>
                )}
              </div>

              {selected.note && (
                <div className="rounded-lg border p-3 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Patient note
                  </p>
                  <p className="mt-1">{selected.note}</p>
                </div>
              )}

              {selected.status !== 'PENDING' && selected.reviewNote && (
                <div className="rounded-lg border p-3 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Review note
                  </p>
                  <p className="mt-1">{selected.reviewNote}</p>
                </div>
              )}

              {/* Review zone */}
              {selected.status === 'PENDING' && (
                <div className="space-y-3">
                  <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <AlertTitle>Before you approve</AlertTitle>
                    <AlertDescription>
                      Approving will confirm the linked order and deduct stock.
                    </AlertDescription>
                  </Alert>

                  <div className="space-y-1.5">
                    <Textarea
                      rows={2}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Review note (optional for approval, required for rejection)"
                    />
                  </div>

                  <DialogFooter className="gap-2">
                    <Button
                      variant="destructive"
                      disabled={pending}
                      onClick={() => setRejectConfirm(true)}
                    >
                      <XCircle className="h-4 w-4" /> Reject
                    </Button>
                    <Button
                      className="bg-emerald-600 text-white hover:bg-emerald-700"
                      disabled={pending}
                      onClick={() => void review('APPROVED')}
                    >
                      {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                      <CheckCircle2 className="h-4 w-4" /> Approve
                    </Button>
                  </DialogFooter>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Reject confirm */}
      <AlertDialog open={rejectConfirm} onOpenChange={setRejectConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject this prescription?</AlertDialogTitle>
            <AlertDialogDescription>
              The linked order will stay unconfirmed and the patient will see the rejection with your
              note. Make sure you added a review note explaining why.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={pending}
              onClick={() => void review('REJECTED')}
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Reject prescription
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
