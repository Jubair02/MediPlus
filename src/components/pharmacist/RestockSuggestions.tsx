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
  TriangleAlert,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { downloadCsv } from '@/lib/download'
import { fmtBDT } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { RestockSuggestion } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
            <Table className="min-w-[880px]">
              <TableHeader>
                <TableRow>
                  {[...Array(7)].map((_, i) => (
                    <TableHead key={i}>
                      <Skeleton className="h-4 w-16" />
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...Array(3)].map((_, i) => (
                  <TableRow key={`sk-${i}`}>
                    <TableCell colSpan={7}>
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

export default function RestockSuggestions() {
  const [suggestions, setSuggestions] = useState<RestockSuggestion[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exportPending, setExportPending] = useState(false)
  const [copying, setCopying] = useState(false)

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
        <div className="flex items-center gap-2">
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
    </div>
  )
}
