'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  Copy,
  Download,
  HandCoins,
  Loader2,
  PackagePlus,
  PackageSearch,
  RefreshCw,
  ShoppingCart,
  TriangleAlert,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { downloadCsv } from '@/lib/download'
import { useAppStore } from '@/lib/store'
import { fmtBDT } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { RestockSuggestion } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import MedImage from './MedImage'

/** 1dp when fractional, plain integer otherwise (100 → "100", 2.1 → "2.1"). */
function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

function daysLeftLabel(daysLeft: number | null): string {
  if (daysLeft === null) return '—'
  return fmtNum(daysLeft)
}

/** Today as a local YYYY-MM-DD string (used as the date input min). */
function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function StatChip({
  label,
  value,
  sub,
  icon,
  tone,
}: {
  label: string
  value: string | number
  sub: string
  icon: React.ReactNode
  tone: string
}) {
  return (
    <Card className="gap-1 p-4">
      <div className="flex items-center gap-2">
        <span className={cn('flex size-8 items-center justify-center rounded-lg', tone)}>{icon}</span>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
      </div>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-[11px] text-muted-foreground">{sub}</p>
    </Card>
  )
}

function RestockSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-[86px] rounded-xl" />
        ))}
      </div>
      <Card className="gap-0 py-4">
        <CardContent className="px-4">
          <div className="overflow-x-auto rounded-md border scrollbar-thin">
            <Table className="min-w-[940px]">
              <TableHeader>
                <TableRow>
                  {[...Array(8)].map((_, i) => (
                    <TableHead key={i}>
                      <Skeleton className="h-4 w-16" />
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...Array(3)].map((_, i) => (
                  <TableRow key={`sk-${i}`}>
                    <TableCell colSpan={8}>
                      <Skeleton className="h-10 w-full" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/** Plain-text PO draft for suppliers — mirrors the table rows. */
export function buildPoDraft(list: RestockSuggestion[]): string {
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const lines = list.map((s, i) => {
    const days = s.daysLeft != null ? `~${fmtNum(s.daysLeft)}d left` : 'no recent sales'
    const brand = s.brand ? ` (${s.brand})` : ''
    return `${i + 1}. ${s.name}${brand} (${s.unit}) — suggested ${s.suggestedQty} (stock ${s.stock}, ${days}) — est ${fmtBDT(s.estValue)}`
  })
  return ['MediPlus restock draft — ' + date, ...lines].join('\n')
}

interface RestockSuggestionsProps {
  /** Notify the dashboard so nav badges/stats stay in sync after creating POs. */
  onStatsChanged?: () => void
}

export default function RestockSuggestions({ onStatsChanged }: RestockSuggestionsProps) {
  const [suggestions, setSuggestions] = useState<RestockSuggestion[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exportPending, setExportPending] = useState(false)
  const [copying, setCopying] = useState(false)
  // Per-row create-po pending ids (Round 10; the per-row pending state is now
  // tied to the create-PO dialog submit, Round 11)
  const [orderingIds, setOrderingIds] = useState<Set<string>>(new Set())
  // Raising a purchase order directly is admin-only: everyone else goes through a
  // stock request, which is reviewed before anything is ordered. Without this the
  // ordering controls would simply 403 for a pharmacist.
  const canOrderDirectly = useAppStore((s) => s.user?.role) === 'ADMIN'
  const [orderAllPending, setOrderAllPending] = useState(false)
  const [orderAllConfirm, setOrderAllConfirm] = useState(false)
  // Round 11 — per-row "Mark as ordered" create-PO dialog state
  const [poTarget, setPoTarget] = useState<RestockSuggestion | null>(null)
  const [poQty, setPoQty] = useState('')
  const [poSupplier, setPoSupplier] = useState('')
  const [poExpectedAt, setPoExpectedAt] = useState('')
  const [poNote, setPoNote] = useState('')
  const [poError, setPoError] = useState<string | null>(null)
  const [poSubmitting, setPoSubmitting] = useState(false)

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true)
    else {
      setLoading(true)
      setError(null)
    }
    try {
      const d = await api<{ suggestions: RestockSuggestion[] }>(
        '/api/pharmacist?resource=restock-suggestions'
      )
      setSuggestions(d.suggestions)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load restock suggestions'
      if (silent) toast.error(message)
      else setError(message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const totals = useMemo(() => {
    const list = suggestions ?? []
    return {
      units: list.reduce((sum, s) => sum + s.suggestedQty, 0),
      spend: list.reduce((sum, s) => sum + s.estValue, 0),
      critical: list.filter((s) => s.daysLeft === 0 || s.stock === 0).length,
    }
  }, [suggestions])

  /** Lines that still need a PO (not already covered by an open one). */
  const needOrdering = useMemo(() => {
    const list = suggestions ?? []
    return list.filter((s) => (s.openPoQty ?? 0) < s.suggestedQty) // i.e. shortfallOf(s) > 0
  }, [suggestions])

  function openPoQtyOf(s: RestockSuggestion): number {
    return s.openPoQty ?? 0
  }

  /**
   * Units still to order for a line: the suggestion minus what open POs already cover.
   *
   * `suggestedQty` is the target stock position, not an increment — a line suggested 50
   * with 40 already on an open PO needs 10 more, not another 50. Ordering `suggestedQty`
   * outright is how "Order all" used to double-order every partially covered line.
   */
  function shortfallOf(s: RestockSuggestion): number {
    return Math.max(0, s.suggestedQty - openPoQtyOf(s))
  }

  /** `estValue` covers the whole suggestion; pro-rate it to the units actually ordered. */
  function shortfallValueOf(s: RestockSuggestion): number {
    if (s.suggestedQty <= 0) return 0
    return (s.estValue / s.suggestedQty) * shortfallOf(s)
  }

  function openPoDialog(s: RestockSuggestion) {
    setPoTarget(s)
    // Default to what is still missing, not the full suggestion (see shortfallOf).
    setPoQty(String(shortfallOf(s) || s.suggestedQty))
    setPoSupplier('')
    setPoExpectedAt('')
    setPoNote('')
    setPoError(null)
  }

  function closePoDialog() {
    setPoTarget(null)
    setPoQty('')
    setPoSupplier('')
    setPoExpectedAt('')
    setPoNote('')
    setPoError(null)
  }

  async function submitPo(): Promise<void> {
    const s = poTarget
    if (!s || poSubmitting) return
    const qty = Number(poQty)
    if (poQty.trim() === '' || !Number.isInteger(qty) || qty < 1 || qty > 10000) {
      setPoError('Quantity must be between 1 and 10000')
      return
    }
    setPoError(null)
    setPoSubmitting(true)
    setOrderingIds((prev) => {
      const next = new Set(prev)
      next.add(s.id)
      return next
    })
    try {
      const supplier = poSupplier.trim()
      const note = poNote.trim()
      await api<{ order: unknown }>('/api/pharmacist', {
        method: 'PUT',
        body: {
          action: 'create-po',
          medicineId: s.id,
          qty,
          ...(supplier !== '' ? { supplier } : {}),
          ...(poExpectedAt !== '' ? { expectedAt: poExpectedAt } : {}),
          ...(note !== '' ? { note } : {}),
        },
      })
      toast.success(`PO created — ${qty} × ${s.name}`)
      closePoDialog()
      onStatsChanged?.()
      await load(true) // silent refresh so openPoQty / coverage chips update
    } catch (e) {
      // Server 400 (e.g. supplier/date validation) — keep the dialog open
      toast.error(e instanceof Error ? e.message : 'Failed to create purchase order')
    } finally {
      setPoSubmitting(false)
      setOrderingIds((prev) => {
        const next = new Set(prev)
        next.delete(s.id)
        return next
      })
    }
  }

  async function orderAll() {
    if (needOrdering.length === 0) return
    setOrderAllPending(true)
    let ok = 0
    let failed = 0
    let firstError: string | null = null
    try {
      for (const s of needOrdering) {
        const qty = shortfallOf(s)
        if (qty < 1) continue
        try {
          await api<{ order: unknown }>('/api/pharmacist', {
            method: 'PUT',
            body: { action: 'create-po', medicineId: s.id, qty },
          })
          ok++
        } catch (e) {
          failed++
          if (!firstError) firstError = e instanceof Error ? e.message : 'Unknown error'
        }
      }
      if (ok > 0) {
        toast.success(`Created ${ok} purchase order${ok === 1 ? '' : 's'}${failed > 0 ? ` — ${failed} failed` : ''}`)
        onStatsChanged?.()
        await load(true)
      }
      if (failed > 0) {
        toast.error(`Failed ${failed} order${failed === 1 ? '' : 's'} — ${firstError ?? 'unknown error'}`)
        await load(true)
      }
    } finally {
      setOrderAllPending(false)
      setOrderAllConfirm(false)
    }
  }

  async function exportCsv() {
    setExportPending(true)
    try {
      const d = await api<{ filename: string; csv: string }>(
        '/api/pharmacist?resource=export-restock'
      )
      if (typeof d.csv !== 'string' || typeof d.filename !== 'string')
        throw new Error('Export unavailable')
      downloadCsv(d.filename, d.csv)
      toast.success('Restock list exported')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to export restock list')
    } finally {
      setExportPending(false)
    }
  }

  async function copyAsText() {
    if (!suggestions || suggestions.length === 0) return
    setCopying(true)
    try {
      await navigator.clipboard.writeText(buildPoDraft(suggestions))
      toast.success('PO draft copied')
    } catch {
      toast.error('Could not access the clipboard')
    } finally {
      setCopying(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Low-stock items with reorder quantities based on recent sales.
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => void load(true)}
            disabled={refreshing}
            aria-label="Refresh restock suggestions"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
          </Button>
          <Button
            variant="ghost"
            onClick={() => void copyAsText()}
            disabled={copying || !suggestions || suggestions.length === 0}
          >
            {copying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
            Copy as text
          </Button>
          <Button
            variant="outline"
            onClick={() => void exportCsv()}
            disabled={exportPending || !suggestions || suggestions.length === 0}
          >
            {exportPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Export CSV
          </Button>
          {!canOrderDirectly ? (
            <span title="Direct ordering is admin-only — raise a stock request instead">
              <Button variant="default" disabled>
                <PackagePlus className="h-4 w-4" />
                Order all
              </Button>
            </span>
          ) : needOrdering.length === 0 && suggestions && suggestions.length > 0 ? (
            <span title="All lines already covered">
              <Button variant="default" disabled title="All lines already covered">
                <PackagePlus className="h-4 w-4" />
                Order all
              </Button>
            </span>
          ) : (
            <Button
              variant="default"
              onClick={() => setOrderAllConfirm(true)}
              disabled={orderAllPending || !suggestions || suggestions.length === 0}
            >
              {orderAllPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PackagePlus className="h-4 w-4" />
              )}
              Order all
            </Button>
          )}
        </div>
      </div>

      {error ? (
        <Card className="flex-col items-center gap-2 p-10 text-center">
          <PackageSearch className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </Button>
        </Card>
      ) : loading && !suggestions ? (
        <RestockSkeleton />
      ) : !suggestions || suggestions.length === 0 ? (
        <Card className="flex-col items-center gap-3 p-10 text-center">
          <CheckCircle2 className="h-10 w-10 text-emerald-600" />
          <div>
            <p className="text-sm font-medium">Nothing to reorder</p>
            <p className="text-sm text-muted-foreground">
              No items below the stock threshold — inventory looks healthy.
            </p>
          </div>
        </Card>
      ) : (
        <>
          {/* Summary strip */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatChip
              label="Items to reorder"
              value={suggestions.length}
              sub="below the stock threshold"
              tone="bg-amber-100"
              icon={<PackageSearch className="size-4 text-amber-700" aria-hidden="true" />}
            />
            <StatChip
              label="Units suggested"
              value={totals.units}
              sub="across all suggested lines"
              tone="bg-primary/10"
              icon={<PackagePlus className="text-primary size-4" aria-hidden="true" />}
            />
            <StatChip
              label="Estimated spend"
              value={fmtBDT(totals.spend)}
              sub="if everything is ordered"
              tone="bg-emerald-100"
              icon={<HandCoins className="size-4 text-emerald-700" aria-hidden="true" />}
            />
            <StatChip
              label="Critical / out"
              value={totals.critical}
              sub="out of stock or zero days left"
              tone="bg-red-100"
              icon={<TriangleAlert className="size-4 text-red-600" aria-hidden="true" />}
            />
          </div>

          {/* Suggestions table */}
          <Card className="gap-0 py-4">
            <CardContent className="px-4">
              <div className="max-h-[60vh] overflow-auto rounded-md border scrollbar-thin">
                <Table className="min-w-[880px]" aria-label="Restock suggestions">
                  <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_var(--border)]">
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Medicine</TableHead>
                      <TableHead className="text-center">Stock</TableHead>
                      <TableHead className="text-center">Sold 30d</TableHead>
                      <TableHead className="text-right">Avg/day</TableHead>
                      <TableHead className="text-right">Days left</TableHead>
                      <TableHead className="text-right">Suggested qty</TableHead>
                      <TableHead className="text-right">Est. value</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {suggestions.map((s) => {
                      const out = s.stock === 0
                      const critical = s.daysLeft !== null && s.daysLeft <= 2
                      const soon = s.daysLeft !== null && s.daysLeft > 2 && s.daysLeft <= 7
                      return (
                        <TableRow key={s.id} className="transition-colors hover:bg-accent/40">
                          <TableCell>
                            <div className="flex items-center gap-2.5">
                              <MedImage
                                src={s.image}
                                alt={s.name}
                                className="h-9 w-9 shrink-0 rounded-md border object-cover"
                              />
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">{s.name}</p>
                                <p className="max-w-52 truncate text-xs text-muted-foreground">
                                  {[s.brand, s.genericName].filter(Boolean).join(' · ') || s.unit}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-center">
                            <span className="inline-flex items-center gap-1.5">
                              <span className="text-sm tabular-nums">{s.stock}</span>
                              {out ? (
                                <Badge
                                  variant="outline"
                                  className="border-red-300 bg-red-100 text-red-800"
                                >
                                  Out
                                </Badge>
                              ) : (
                                s.stock <= s.lowStockAt && (
                                  <Badge
                                    variant="outline"
                                    className="border-amber-300 bg-amber-100 text-amber-800"
                                  >
                                    Low
                                  </Badge>
                                )
                              )}
                            </span>
                          </TableCell>
                          <TableCell className="text-center text-sm tabular-nums">
                            {s.soldLast30}
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums">
                            {fmtNum(s.avgDaily)}
                          </TableCell>
                          <TableCell
                            className={cn(
                              'whitespace-nowrap text-right text-sm tabular-nums',
                              critical && 'font-bold text-red-600 dark:text-red-400',
                              soon && 'font-medium text-amber-600 dark:text-amber-400',
                              s.daysLeft === null && 'text-muted-foreground'
                            )}
                          >
                            {daysLeftLabel(s.daysLeft)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right text-sm font-bold text-primary tabular-nums">
                            {s.suggestedQty}
                            <span className="ml-1 text-xs font-normal text-muted-foreground">
                              {s.unit}
                            </span>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right text-sm font-medium">
                            {fmtBDT(s.estValue)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            <div className="flex flex-col items-end gap-1">
                              {openPoQtyOf(s) > 0 && (
                                <span
                                  className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 tabular-nums dark:bg-amber-500/15 dark:text-amber-300"
                                  title={`${openPoQtyOf(s)} units of this line are on an open purchase order`}
                                >
                                  PO {openPoQtyOf(s)} on order
                                </span>
                              )}
                              {openPoQtyOf(s) >= s.suggestedQty ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled
                                  title="This line is already covered by an open PO"
                                  className="h-8 border-emerald-300! bg-emerald-100! text-emerald-700! dark:border-emerald-700/60! dark:bg-emerald-950/40! dark:text-emerald-300!"
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  Ordered ✓
                                </Button>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 focus-visible:ring-primary/30"
                                  disabled={orderingIds.has(s.id) || !canOrderDirectly}
                                  title={
                                    canOrderDirectly
                                      ? undefined
                                      : 'Direct ordering is admin-only — raise a stock request instead'
                                  }
                                  onClick={() => openPoDialog(s)}
                                >
                                  {orderingIds.has(s.id) ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <ShoppingCart className="h-3.5 w-3.5" />
                                  )}
                                  Mark as ordered
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            Suggestions use the last 30 days of sales (1.5× coverage, min 30 units) — review before
            ordering.
          </p>
        </>
      )}

      {/* Order-all confirm */}
      <AlertDialog open={orderAllConfirm} onOpenChange={setOrderAllConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create purchase orders for all suggested lines?</AlertDialogTitle>
            <AlertDialogDescription>
              {needOrdering.length} order{needOrdering.length === 1 ? '' : 's'}, ~
              {fmtBDT(needOrdering.reduce((sum, s) => sum + shortfallValueOf(s), 0))} total — each
              line is ordered up to its suggested quantity, so units already on an open PO are
              deducted and fully covered lines are skipped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={orderAllPending}>Go back</AlertDialogCancel>
            <AlertDialogAction
              disabled={orderAllPending}
              onClick={(e) => {
                e.preventDefault()
                void orderAll()
              }}
            >
              {orderAllPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Create {needOrdering.length} order{needOrdering.length === 1 ? '' : 's'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Round 11 — "Mark as ordered" create-PO dialog (supplier / expected delivery / note) */}
      <Dialog
        open={poTarget !== null}
        onOpenChange={(o) => {
          if (!o && !poSubmitting) closePoDialog()
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto scrollbar-thin sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create purchase order</DialogTitle>
            <DialogDescription>
              Confirm the quantity and optionally set a supplier and expected delivery date.
            </DialogDescription>
          </DialogHeader>

          {poTarget && (
            <div className="flex items-center gap-2.5 rounded-lg border bg-muted/40 p-2.5">
              <MedImage
                src={poTarget.image}
                alt={poTarget.name}
                className="h-10 w-10 shrink-0 rounded-md border border-border bg-muted object-cover"
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{poTarget.name}</p>
                <p className="text-xs text-muted-foreground">
                  Suggested qty:{' '}
                  <span className="font-medium text-foreground tabular-nums">
                    {poTarget.suggestedQty}
                  </span>{' '}
                  {poTarget.unit}
                  {openPoQtyOf(poTarget) > 0 && (
                    <>
                      {' '}
                      · <span className="tabular-nums">PO {openPoQtyOf(poTarget)}</span> on order
                    </>
                  )}
                </p>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="po-qty">Quantity *</Label>
              <Input
                id="po-qty"
                type="number"
                min={1}
                max={10000}
                step={1}
                value={poQty}
                onChange={(e) => {
                  setPoQty(e.target.value)
                  setPoError(null)
                }}
                className="tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor="po-supplier">Supplier</Label>
                {poSupplier.length > 100 && (
                  <span
                    className={cn(
                      'text-[11px] tabular-nums',
                      poSupplier.length >= 120
                        ? 'font-medium text-red-600 dark:text-red-400'
                        : 'text-muted-foreground'
                    )}
                  >
                    {poSupplier.length} / 120
                  </span>
                )}
              </div>
              <Input
                id="po-supplier"
                value={poSupplier}
                maxLength={120}
                onChange={(e) => setPoSupplier(e.target.value)}
                placeholder="e.g. Square Pharmaceuticals Ltd."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="po-expected">Expected delivery</Label>
              <Input
                id="po-expected"
                type="date"
                min={todayLocal()}
                value={poExpectedAt}
                onChange={(e) => setPoExpectedAt(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="po-note">Note</Label>
              <Input
                id="po-note"
                value={poNote}
                maxLength={300}
                onChange={(e) => setPoNote(e.target.value)}
                placeholder="Optional note (max 300 characters)"
              />
            </div>
            {poError && <p className="text-sm font-medium text-red-600">{poError}</p>}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={closePoDialog} disabled={poSubmitting}>
              Cancel
            </Button>
            <Button onClick={() => void submitPo()} disabled={poSubmitting}>
              {poSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Create PO
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
