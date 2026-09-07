'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, History, PackageOpen, RefreshCw } from 'lucide-react'
import { api } from '@/lib/api'
import { fmtDateTime } from '@/lib/format'
import { STOCK_MOVEMENT_REASONS, type Medicine, type StockMovementItem, type StockMovementReason } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import MedImage from './MedImage'

// Keyed by StockMovementReason so the compiler refuses a reason without a label —
// which is how PO_RECEIVE went missing from this screen in the first place.
const REASON_META: Record<StockMovementReason, { label: string; tone: string }> = {
  OPENING: { label: 'Opening balance', tone: 'bg-violet-100 text-violet-700 border-violet-300' },
  PO_RECEIVE: { label: 'PO received', tone: 'bg-sky-100 text-sky-800 border-sky-300' },
  ORDER_CONFIRM: { label: 'Confirmed', tone: 'bg-teal-100 text-teal-800 border-teal-300' },
  RX_APPROVE: { label: 'Rx approved', tone: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
  ORDER_CANCEL: { label: 'Cancelled', tone: 'bg-amber-100 text-amber-800 border-amber-300' },
  MANUAL_EDIT: { label: 'Manual edit', tone: 'bg-gray-100 text-gray-600 border-gray-300' },
  SEED: { label: 'Seed', tone: 'border-gray-300 text-gray-500' },
}

const REASONS = STOCK_MOVEMENT_REASONS

function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta}`
  if (delta < 0) return `−${Math.abs(delta)}`
  return '0'
}

function deltaTone(delta: number): string {
  if (delta > 0) return 'bg-emerald-100 text-emerald-700 border-emerald-300'
  if (delta < 0) return 'bg-red-100 text-red-700 border-red-300'
  return 'bg-gray-100 text-gray-600 border-gray-300'
}

function DeltaBadge({ delta }: { delta: number }) {
  return (
    <Badge variant="outline" className={`border font-mono ${deltaTone(delta)}`}>
      {formatDelta(delta)}
    </Badge>
  )
}

function ReasonChip({ reason }: { reason: string }) {
  const meta = REASON_META[reason] ?? { label: reason, tone: 'border-gray-300 text-gray-500' }
  return (
    <Badge variant="outline" className={`border whitespace-nowrap ${meta.tone}`}>
      {meta.label}
    </Badge>
  )
}

function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError'
}

const MOVEMENTS_URL = '/api/pharmacist?resource=movements&take=100'

export default function StockLog() {
  const [movements, setMovements] = useState<StockMovementItem[]>([])
  const [meds, setMeds] = useState<Medicine[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [medFilter, setMedFilter] = useState('ALL')
  const [reasonFilter, setReasonFilter] = useState('ALL')

  // Initial load — setState only inside promise callbacks (no sync setState in effect)
  useEffect(() => {
    const ctrl = new AbortController()
    api<{ movements: StockMovementItem[] }>(MOVEMENTS_URL, { signal: ctrl.signal })
      .then((d) => {
        if (ctrl.signal.aborted) return
        setMovements(d.movements ?? [])
        setError(null)
      })
      .catch((e: unknown) => {
        if (isAbortError(e) || ctrl.signal.aborted) return
        setError(e instanceof Error ? e.message : 'Failed to load stock movements')
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })
    return () => ctrl.abort()
  }, [])

  // Medicine filter options (fetch once; degrade gracefully if unavailable)
  useEffect(() => {
    const ctrl = new AbortController()
    api<{ medicines: Medicine[] }>('/api/pharmacist?resource=medicines', { signal: ctrl.signal })
      .then((d) => setMeds(d.medicines ?? []))
      .catch(() => undefined)
    return () => ctrl.abort()
  }, [])

  async function refresh() {
    setRefreshing(true)
    try {
      const d = await api<{ movements: StockMovementItem[] }>(MOVEMENTS_URL)
      setMovements(d.movements ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load stock movements')
    } finally {
      setRefreshing(false)
    }
  }

  const filtered = useMemo(
    () =>
      movements.filter(
        (m) =>
          (medFilter === 'ALL' || m.medicine?.id === medFilter) &&
          (reasonFilter === 'ALL' || m.reason === reasonFilter)
      ),
    [movements, medFilter, reasonFilter]
  )

  const summary = useMemo(() => {
    const now = new Date()
    let net = 0
    let today = 0
    for (const m of filtered) {
      net += m.delta
      const d = new Date(m.createdAt)
      if (
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate()
      )
        today++
    }
    return { net, today }
  }, [filtered])

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={medFilter} onValueChange={setMedFilter}>
          <SelectTrigger aria-label="Filter by medicine" className="w-full sm:w-[230px]">
            <SelectValue placeholder="All medicines" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value="ALL">All medicines</SelectItem>
            {meds.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={reasonFilter} onValueChange={setReasonFilter}>
          <SelectTrigger aria-label="Filter by reason" className="w-full sm:w-[170px]">
            <SelectValue placeholder="All reasons" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All reasons</SelectItem>
            {REASONS.map((r) => (
              <SelectItem key={r} value={r}>
                {REASON_META[r].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="sm:ml-auto">
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            onClick={() => void refresh()}
            disabled={refreshing}
            title="Refresh stock log"
            aria-label="Refresh stock log"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="border bg-teal-100 text-teal-800 border-teal-300">
          <History className="h-3 w-3" />
          {filtered.length} movement{filtered.length === 1 ? '' : 's'}
        </Badge>
        <Badge variant="outline" className={`border font-mono ${deltaTone(summary.net)}`}>
          Net {formatDelta(summary.net)}
        </Badge>
        <Badge variant="outline" className="border bg-amber-100 text-amber-800 border-amber-300">
          {summary.today} today
        </Badge>
      </div>

      {/* Table */}
      <Card className="gap-0 py-4">
        <CardContent className="px-4">
          <div className="max-h-[65vh] overflow-auto rounded-md border scrollbar-thin">
            <Table className="min-w-[760px]">
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Medicine</TableHead>
                  <TableHead className="text-center">Change</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  [...Array(8)].map((_, i) => (
                    <TableRow key={`sk-${i}`}>
                      <TableCell colSpan={6}>
                        <Skeleton className="h-9 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : error ? (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <div className="flex flex-col items-center gap-3 py-10 text-center">
                        <AlertTriangle className="h-8 w-8 text-amber-500" />
                        <p className="text-sm text-muted-foreground">{error}</p>
                        <Button variant="outline" size="sm" onClick={() => void refresh()}>
                          <RefreshCw className="h-3.5 w-3.5" /> Retry
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <div className="flex flex-col items-center gap-2 py-10 text-center">
                        <PackageOpen className="h-8 w-8 text-muted-foreground/50" />
                        <p className="text-sm text-muted-foreground">
                          {movements.length === 0
                            ? 'No stock movements recorded yet.'
                            : 'No movements match your filters.'}
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((m) => (
                    <TableRow key={m.id} className="transition-colors hover:bg-accent/40">
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {fmtDateTime(m.createdAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <MedImage
                            src={m.medicine?.image}
                            alt={m.medicine?.name ?? 'Medicine'}
                            className="h-8 w-8 shrink-0 rounded"
                          />
                          <span className="max-w-52 truncate text-sm font-medium">
                            {m.medicine?.name ?? 'Unknown medicine'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <DeltaBadge delta={m.delta} />
                      </TableCell>
                      <TableCell>
                        <ReasonChip reason={m.reason} />
                      </TableCell>
                      <TableCell className="max-w-48">
                        {m.note ? (
                          <span
                            className="block max-w-48 truncate text-xs text-muted-foreground"
                            title={m.note}
                          >
                            {m.note}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/60">—</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-32 truncate text-sm">
                        {m.user?.name ?? 'System'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
