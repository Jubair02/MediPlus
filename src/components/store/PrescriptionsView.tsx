'use client'

import { useEffect, useRef, useState } from 'react'
import { FileText, Info, Loader2, LogIn, UploadCloud } from 'lucide-react'
import { toast } from 'sonner'
import { api, fileToCompressedDataUrl } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { fmtDate } from '@/lib/format'
import type { Prescription } from '@/lib/types'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

const statusBadgeClass: Record<Prescription['status'], string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-red-100 text-red-700',
}

export default function PrescriptionsView() {
  const user = useAppStore((s) => s.user)
  const setAuthOpen = useAppStore((s) => s.setAuthOpen)

  const [prescriptions, setPrescriptions] = useState<Prescription[] | null>(null)
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [processing, setProcessing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!user) return
    const ac = new AbortController()
    api<{ prescriptions: Prescription[] }>('/api/prescriptions', { signal: ac.signal })
      .then((d) => setPrescriptions(d.prescriptions))
      .catch(() => {})
    return () => ac.abort()
  }, [user])

  // ---------- guard ----------
  if (!user) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-primary/10">
          <LogIn className="size-8 text-primary" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-xl font-bold">Sign in to manage prescriptions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload prescriptions and let our pharmacists review them.
        </p>
        <Button className="mt-6 h-11 rounded-xl" onClick={() => setAuthOpen(true)}>
          <LogIn className="size-4" aria-hidden="true" />
          Sign in
        </Button>
      </div>
    )
  }

  const onPickFile = async (file: File | undefined) => {
    if (!file) return
    setProcessing(true)
    try {
      const url = await fileToCompressedDataUrl(file)
      setDataUrl(url)
      setFileName(file.name)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not read that image')
    } finally {
      setProcessing(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const submit = async () => {
    if (!dataUrl) {
      toast.error('Please choose a prescription photo first')
      return
    }
    setSubmitting(true)
    try {
      const d = await api<{ prescription: Prescription }>('/api/prescriptions', {
        method: 'POST',
        body: { image: dataUrl, note: note.trim() || undefined },
      })
      setPrescriptions((prev) => [d.prescription, ...(prev ?? [])])
      setDataUrl(null)
      setFileName(null)
      setNote('')
      toast.success('Prescription submitted — a pharmacist will review it shortly')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to upload prescription')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 pt-6 lg:px-6">
      <h1 className="text-xl font-bold tracking-tight sm:text-2xl">My prescriptions</h1>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[24rem_1fr]">
        {/* ---------- Upload ---------- */}
        <Card className="gap-4 p-5 shadow-sm">
          <h2 className="flex items-center gap-2 font-semibold">
            <UploadCloud className="size-4 text-primary" aria-hidden="true" />
            Upload prescription
          </h2>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void onPickFile(e.target.files?.[0])}
          />

          {dataUrl ? (
            <div className="space-y-3">
              <img
                src={dataUrl}
                alt="Prescription preview"
                className="max-h-48 w-auto rounded-lg border"
              />
              <p className="truncate text-xs text-muted-foreground">{fileName}</p>
              <Button
                variant="outline"
                size="sm"
                className="h-9 rounded-lg"
                onClick={() => fileInputRef.current?.click()}
              >
                Choose a different photo
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
            >
              {processing ? (
                <Loader2 className="size-7 animate-spin text-primary" aria-hidden="true" />
              ) : (
                <UploadCloud className="size-7 text-primary" aria-hidden="true" />
              )}
              {processing ? 'Processing image…' : 'Tap to choose a photo of your prescription'}
            </button>
          )}

          <Textarea
            placeholder="Note for the pharmacist (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="min-h-20"
          />

          <Button
            className="h-11 w-full rounded-xl"
            disabled={!dataUrl || submitting || processing}
            onClick={() => void submit()}
          >
            {submitting && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {submitting ? 'Uploading…' : 'Submit for review'}
          </Button>

          <Alert className="border-primary/30 bg-primary/5 text-foreground">
            <Info className="size-4 text-primary" aria-hidden="true" />
            <AlertDescription>
              A licensed pharmacist reviews every prescription within 30 minutes (demo).
            </AlertDescription>
          </Alert>
        </Card>

        {/* ---------- List ---------- */}
        <div>
          {prescriptions === null ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-44 rounded-xl" />
              ))}
            </div>
          ) : prescriptions.length === 0 ? (
            <Card className="flex-col items-center gap-2 p-10 text-center shadow-sm">
              <span className="flex size-14 items-center justify-center rounded-full bg-muted">
                <FileText className="size-7 text-muted-foreground" aria-hidden="true" />
              </span>
              <p className="font-semibold">No prescriptions yet</p>
              <p className="max-w-xs text-sm text-muted-foreground">
                Upload a prescription to buy Rx medicines — approval usually takes minutes.
              </p>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {prescriptions.map((p) => (
                <Card key={p.id} className="gap-3 p-4 shadow-sm">
                  <div className="flex items-start gap-3">
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-lg med-gradient">
                      <FileText className="size-6 text-white" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold">{fmtDate(p.createdAt)}</p>
                        <Badge className={cn('rounded-md', statusBadgeClass[p.status])}>
                          {p.status}
                        </Badge>
                      </div>
                      {p.note ? (
                        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{p.note}</p>
                      ) : (
                        <p className="mt-1 text-xs text-muted-foreground">No note attached</p>
                      )}
                    </div>
                  </div>
                  {p.reviewNote && (
                    <p className="rounded-lg bg-muted px-3 py-2 text-xs italic text-muted-foreground">
                      Pharmacist: “{p.reviewNote}”
                    </p>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
