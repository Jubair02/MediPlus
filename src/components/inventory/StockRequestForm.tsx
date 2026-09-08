'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Search, Trash2, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { Medicine, StockRequestPriorityValue, StockRequestRow } from '@/lib/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { PRIORITY_LABELS } from './stock-request-ui'

const PRIORITIES: StockRequestPriorityValue[] = ['LOW', 'MEDIUM', 'HIGH', 'EMERGENCY']
const MAX_ITEMS = 50

interface Line {
  medicineId: string
  name: string
  unit: string
  stock: number
  qty: string
  note: string
}

export interface PrefillLine {
  medicineId: string
  suggestedQty: number
}

/**
 * Raise a stock request for one or more medicines.
 *
 * Deliberately does not let the requester set an approved quantity or a supplier:
 * this form records a need. What is actually bought is the reviewer's decision, and
 * where it is bought from is settled when the purchase order is raised.
 */
export default function StockRequestForm({
  open,
  onOpenChange,
  onCreated,
  prefill,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (created: StockRequestRow) => void
  /** Seeded from the restock suggestions, so "Request all" arrives pre-filled. */
  prefill?: PrefillLine[]
}) {
  const [medicines, setMedicines] = useState<Medicine[] | null>(null)
  const [loadingMeds, setLoadingMeds] = useState(false)
  const [lines, setLines] = useState<Line[]>([])
  const [priority, setPriority] = useState<StockRequestPriorityValue>('MEDIUM')
  const [reason, setReason] = useState('')
  const [expectedAt, setExpectedAt] = useState('')
  const [search, setSearch] = useState('')
  const [submitting, setSubmitting] = useState<'draft' | 'submit' | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Load the catalogue once the dialog is actually opened, not on mount. Any prefill is
  // resolved in the same pass rather than in a second effect: the lines need real names,
  // units and stock, so they cannot be built until the catalogue has arrived anyway.
  useEffect(() => {
    if (!open || medicines !== null) return
    let cancelled = false
    setLoadingMeds(true)
    api<{ medicines: Medicine[] }>('/api/pharmacist?resource=medicines')
      .then((d) => {
        if (cancelled) return
        const active = d.medicines.filter((m) => m.status === 'ACTIVE')
        setMedicines(active)
        if (prefill && prefill.length > 0) {
          const byId = new Map(active.map((m) => [m.id, m]))
          const seeded = prefill
            .map((p) => {
              const m = byId.get(p.medicineId)
              if (!m) return null
              return { medicineId: m.id, name: m.name, unit: m.unit, stock: m.stock, qty: String(p.suggestedQty), note: '' }
            })
            .filter((l): l is Line => l !== null)
          setLines((current) => (current.length > 0 ? current : seeded))
        }
      })
      .catch((e) => {
        if (!cancelled) toast.error(e instanceof Error ? e.message : 'Failed to load medicines')
      })
      .finally(() => {
        if (!cancelled) setLoadingMeds(false)
      })
    return () => {
      cancelled = true
    }
    // `prefill` is read only at load time; re-running on a new array identity would
    // fight the user's edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, medicines])

  function reset() {
    setLines([])
    setPriority('MEDIUM')
    setReason('')
    setExpectedAt('')
    setSearch('')
    setError(null)
  }

  const chosen = useMemo(() => new Set(lines.map((l) => l.medicineId)), [lines])

  const options = useMemo(() => {
    if (!medicines) return []
    const q = search.trim().toLowerCase()
    return medicines
      .filter((m) => !chosen.has(m.id))
      .filter((m) =>
        q ? `${m.name} ${m.genericName ?? ''} ${m.brand ?? ''}`.toLowerCase().includes(q) : true
      )
      .slice(0, 8)
  }, [medicines, search, chosen])

  function addLine(m: Medicine) {
    if (lines.length >= MAX_ITEMS) {
      setError(`A request can hold at most ${MAX_ITEMS} medicines`)
      return
    }
    setError(null)
    setLines((l) => [...l, { medicineId: m.id, name: m.name, unit: m.unit, stock: m.stock, qty: '', note: '' }])
    setSearch('')
  }

  function setLine(id: string, patch: Partial<Line>) {
    setLines((l) => l.map((x) => (x.medicineId === id ? { ...x, ...patch } : x)))
  }

  function firstProblem(): string | null {
    if (lines.length === 0) return 'Add at least one medicine'
    for (const l of lines) {
      const n = Number(l.qty)
      if (l.qty.trim() === '' || !Number.isInteger(n) || n < 1) {
        return `Enter a whole quantity of 1 or more for ${l.name}`
      }
      if (n > 10000) return `Quantity for ${l.name} cannot exceed 10000`
    }
    return null
  }

  async function save(mode: 'draft' | 'submit') {
    const problem = firstProblem()
    if (problem) {
      setError(problem)
      return
    }
    setSubmitting(mode)
    setError(null)
    try {
      const d = await api<{ request: StockRequestRow }>('/api/stock-requests', {
        method: 'PUT',
        body: {
          action: 'create',
          submit: mode === 'submit',
          priority,
          reason: reason.trim() || undefined,
          expectedAt: expectedAt || undefined,
          items: lines.map((l) => ({
            medicineId: l.medicineId,
            requestedQty: Number(l.qty),
            note: l.note.trim() || undefined,
          })),
        },
      })
      toast.success(
        mode === 'submit'
          ? `${d.request.requestNo} submitted for review`
          : `${d.request.requestNo} saved as a draft`
      )
      onCreated(d.request)
      reset()
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save the request')
    } finally {
      setSubmitting(null)
    }
  }

  const busy = submitting !== null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[92vh] gap-0 overflow-y-auto p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>New stock request</DialogTitle>
          <DialogDescription>
            Nothing is ordered and no stock changes until an admin approves this and the
            delivery is received.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 px-6 py-5">
          {/* request-level fields */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sr-priority">Priority</Label>
              <Select
                value={priority}
                onValueChange={(v) => setPriority(v as StockRequestPriorityValue)}
                disabled={busy}
              >
                <SelectTrigger id="sr-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PRIORITY_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {priority === 'EMERGENCY' && (
                <p className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                  <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                  Alerts every admin immediately. It does not skip approval or receiving.
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sr-expected">Needed by (optional)</Label>
              <Input
                id="sr-expected"
                type="date"
                value={expectedAt}
                onChange={(e) => setExpectedAt(e.target.value)}
                disabled={busy}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sr-reason">Reason (optional)</Label>
            <Textarea
              id="sr-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why this is needed — the reviewer sees this first"
              rows={2}
              maxLength={500}
              disabled={busy}
            />
          </div>

          {/* medicine picker */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="sr-search">Add medicines</Label>
            <div className="relative">
              <Search
                className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="sr-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={loadingMeds ? 'Loading catalogue…' : 'Search by name, generic or brand'}
                className="pl-8"
                disabled={busy || loadingMeds}
              />
            </div>
            {search.trim() !== '' && (
              <div className="flex flex-col gap-1 rounded-lg border p-1">
                {options.length === 0 ? (
                  <p className="px-2 py-1.5 text-sm text-muted-foreground">No matching medicine.</p>
                ) : (
                  options.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => addLine(m)}
                      className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
                    >
                      <span className="min-w-0 truncate">
                        {m.name}
                        {m.brand && <span className="text-muted-foreground"> · {m.brand}</span>}
                      </span>
                      <span
                        className={cn(
                          'shrink-0 text-xs tabular-nums',
                          m.stock <= 10 ? 'font-semibold text-amber-700 dark:text-amber-400' : 'text-muted-foreground'
                        )}
                      >
                        {m.stock} in stock
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* the lines */}
          {lines.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed py-8 text-center">
              <Plus className="size-5 text-muted-foreground/60" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">Search above to add medicines to this request.</p>
            </div>
          ) : (
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 pr-3 font-medium">Medicine</th>
                    <th className="pb-2 pr-3 text-right font-medium">In stock</th>
                    <th className="pb-2 pr-3 font-medium">Request</th>
                    <th className="pb-2 pr-3 font-medium">Note</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.medicineId} className="border-b last:border-0">
                      <td className="py-2 pr-3">
                        <p className="max-w-48 truncate font-medium">{l.name}</p>
                        <p className="text-[11px] text-muted-foreground">per {l.unit}</p>
                      </td>
                      <td
                        className={cn(
                          'py-2 pr-3 text-right tabular-nums',
                          l.stock <= 10 ? 'font-semibold text-amber-700 dark:text-amber-400' : 'text-muted-foreground'
                        )}
                      >
                        {l.stock}
                      </td>
                      <td className="py-2 pr-3">
                        <Input
                          value={l.qty}
                          onChange={(e) => setLine(l.medicineId, { qty: e.target.value.replace(/[^\d]/g, '') })}
                          inputMode="numeric"
                          placeholder="Qty"
                          aria-label={`Quantity for ${l.name}`}
                          className="h-8 w-24 tabular-nums"
                          disabled={busy}
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <Input
                          value={l.note}
                          onChange={(e) => setLine(l.medicineId, { note: e.target.value })}
                          placeholder="Optional"
                          aria-label={`Note for ${l.name}`}
                          className="h-8 min-w-32"
                          maxLength={300}
                          disabled={busy}
                        />
                      </td>
                      <td className="py-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground hover:text-red-600"
                          onClick={() => setLines((x) => x.filter((y) => y.medicineId !== l.medicineId))}
                          aria-label={`Remove ${l.name}`}
                          disabled={busy}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {error && (
            <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="items-center gap-2 border-t px-6 py-4 sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {lines.length === 0
              ? 'No medicines yet'
              : `${lines.length} ${lines.length === 1 ? 'medicine' : 'medicines'}`}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void save('draft')} disabled={busy || lines.length === 0}>
              {submitting === 'draft' && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              Save draft
            </Button>
            <Button onClick={() => void save('submit')} disabled={busy || lines.length === 0}>
              {submitting === 'submit' && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              Submit for review
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
