'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  History,
  ScrollText,
  Search,
  TriangleAlert,
  X,
} from 'lucide-react'
import { api } from '@/lib/api'
import { fmtDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { type AuditAction, type AuditLogRow } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface AuditLogResponse {
  rows: AuditLogRow[]
  page: number
  totalPages: number
  total: number
  /** GLOBAL counts — never affected by the action/search filters */
  counts: Partial<Record<'ALL' | AuditAction, number>>
}

type ActionFilter = 'ALL' | AuditAction

const ACTION_FILTERS: { value: ActionFilter; label: string }[] = [
  { value: 'ALL', label: 'All actions' },
  { value: 'PAYMENT_STATUS', label: 'Payment status' },
  { value: 'ORDER_STATUS', label: 'Order status' },
  { value: 'RX_REVIEW', label: 'Rx review' },
  { value: 'PO_CREATE', label: 'PO created' },
  { value: 'PO_RECEIVE', label: 'PO received' },
  { value: 'PO_CANCEL', label: 'PO cancelled' },
  { value: 'USER_STATUS', label: 'User status' },
]

const ACTION_LABELS: Record<string, string> = {
  PAYMENT_STATUS: 'Payment status',
  ORDER_STATUS: 'Order status',
  RX_REVIEW: 'Rx review',
  PO_CREATE: 'PO created',
  PO_RECEIVE: 'PO received',
  PO_CANCEL: 'PO cancelled',
  USER_STATUS: 'User status',
}

const ACTION_TONES: Record<string, string> = {
  ORDER_STATUS:
    'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300',
  PAYMENT_STATUS:
    'border-teal-300 bg-teal-100 text-teal-800 dark:border-teal-500/40 dark:bg-teal-500/10 dark:text-teal-300',
  RX_REVIEW:
    'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300',
  PO_CREATE:
    'border-purple-300 bg-purple-100 text-purple-800 dark:border-purple-500/40 dark:bg-purple-500/10 dark:text-purple-300',
  PO_RECEIVE:
    'border-lime-300 bg-lime-100 text-lime-800 dark:border-lime-500/40 dark:bg-lime-500/10 dark:text-lime-300',
  PO_CANCEL:
    'border-red-300 bg-red-100 text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300',
  USER_STATUS: 'border-muted bg-muted text-muted-foreground',
}

const MUTED_TONE = 'border-border bg-muted text-muted-foreground'

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action
}

function actionTone(action: string): string {
  return ACTION_TONES[action] ?? MUTED_TONE
}

/** Compact relative time for the "Latest entry" stat card (fmtDateTime fallback). */
function timeAgo(iso: string | undefined): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(diff)) return '—'
  const s = Math.max(0, Math.floor(diff / 1000))
  if (s < 60) return 'Just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return fmtDateTime(iso)
}

function StatCard({
  icon: Icon,
  tileClass,
  iconClass,
  label,
  value,
  hint,
}: {
  icon: typeof ScrollText
  tileClass: string
  iconClass: string
  label: string
  value: string
  hint: string
}) {
  return (
    <Card className="gap-1 p-4 transition-shadow hover:shadow-md">
      <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg', tileClass)}>
        <Icon className={cn('h-4.5 w-4.5', iconClass)} />
      </div>
      <div>
        <p className="text-2xl font-bold tracking-tight tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
      <p className="text-[11px] text-muted-foreground/80">{hint}</p>
    </Card>
  )
}

function AuditSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-xl" />
        ))}
      </div>
      <Card className="gap-0 py-4">
        <CardContent className="px-4">
          <div className="overflow-x-auto rounded-md border scrollbar-thin">
            <Table className="min-w-[880px]">
              <TableHeader>
                <TableRow>
                  {[...Array(5)].map((_, i) => (
                    <TableHead key={i}>
                      <Skeleton className="h-4 w-16" />
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...Array(5)].map((_, i) => (
                  <TableRow key={`sk-${i}`}>
                    <TableCell colSpan={5}>
                      <Skeleton className="h-9 w-full" />
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

export default function AdminAuditLog() {
  const [rows, setRows] = useState<AuditLogRow[]>([])
  const [counts, setCounts] = useState<AuditLogResponse['counts'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [action, setAction] = useState<ActionFilter>('ALL')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)

  // Debounce the free-text search (~300ms). A NEW search resets to page 1 —
  // applied atomically (batched setState) so each change triggers exactly one fetch.
  const appliedSearchRef = useRef('')
  useEffect(() => {
    const t = setTimeout(() => {
      const next = search.trim()
      if (next !== appliedSearchRef.current) {
        appliedSearchRef.current = next
        setDebouncedSearch(next)
        setPage(1)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  const buildQuery = useCallback(
    (withPage: boolean) => {
      const q = new URLSearchParams({ resource: 'audit-logs' })
      if (action !== 'ALL') q.set('action', action)
      if (debouncedSearch) q.set('search', debouncedSearch)
      if (withPage) q.set('page', String(page))
      return q.toString()
    },
    [action, debouncedSearch, page]
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const d = await api<AuditLogResponse>(`/api/admin?${buildQuery(true)}`)
      setRows(d.rows)
      setCounts(d.counts ?? {})
      setPage(d.page)
      setTotalPages(d.totalPages)
      setTotalCount(d.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load audit log')
    } finally {
      setLoading(false)
    }
  }, [buildQuery])

  useEffect(() => {
    void load()
  }, [load])

  // counts are GLOBAL — read the exact key, never fall back to ALL (honest labels)
  const countFor = (v: ActionFilter): number | null => (counts ? counts[v] ?? 0 : null)
  const hasFilters = action !== 'ALL' || debouncedSearch !== ''
  const clearFilters = () => {
    appliedSearchRef.current = ''
    setAction('ALL')
    setSearch('')
    setDebouncedSearch('')
    setPage(1)
  }

  const safePage = Math.max(1, page)
  const safeTotalPages = Math.max(1, totalPages)

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select
          value={action}
          onValueChange={(v) => {
            setAction(v as ActionFilter)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-full sm:w-[200px]" aria-label="Filter by action type">
            <SelectValue placeholder="All actions" />
          </SelectTrigger>
          <SelectContent>
            {ACTION_FILTERS.map((f) => {
              const c = countFor(f.value)
              return (
                <SelectItem key={f.value} value={f.value} className="tabular-nums">
                  {f.label}
                  {c !== null ? <span className="text-muted-foreground"> ({c})</span> : null}
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search actor, order no, or detail"
            className="pr-8 pl-8"
            aria-label="Search audit log"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Clear search"
              title="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {error ? (
        <Card className="flex-col items-center gap-2 p-10 text-center">
          <TriangleAlert className="h-8 w-8 text-amber-500" />
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Retry
          </Button>
        </Card>
      ) : loading && !counts ? (
        <AuditSkeleton />
      ) : (
        <>
          {/* Stat mini-row */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              icon={ScrollText}
              tileClass="bg-primary/10"
              iconClass="text-primary"
              label="Total entries"
              value={String(counts?.ALL ?? 0)}
              hint="Every sensitive action on record"
            />
            <StatCard
              icon={History}
              tileClass="bg-teal-100"
              iconClass="text-teal-700"
              label="Latest entry"
              value={timeAgo(rows[0]?.createdAt)}
              hint="Newest matching entry"
            />
            <StatCard
              icon={History}
              tileClass="bg-emerald-100"
              iconClass="text-emerald-700"
              label="This page"
              value={String(rows.length)}
              hint={`of ${totalCount} matching ${totalCount === 1 ? 'entry' : 'entries'}`}
            />
          </div>

          {/* Audit table */}
          {rows.length === 0 ? (
            <div className="mx-auto w-full max-w-md py-16">
              <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed p-8 text-center">
                <span className="flex size-11 items-center justify-center rounded-full bg-primary/10">
                  <ScrollText className="size-5 text-primary" aria-hidden="true" />
                </span>
                <p className="font-semibold">
                  {hasFilters ? 'No entries match your filters' : 'No audit entries yet'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {hasFilters
                    ? 'Try a different action or search term.'
                    : 'Sensitive actions will appear here as staff and admins work.'}
                </p>
                {hasFilters && (
                  <Button variant="outline" size="sm" className="mt-2" onClick={clearFilters}>
                    Clear filters
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <Card className="gap-0 py-4">
              <CardContent className="px-4">
                <div className="max-h-[60vh] overflow-auto rounded-md border scrollbar-thin">
                  <Table className="min-w-[880px]" aria-label="Audit log">
                    <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_var(--border)]">
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Time</TableHead>
                        <TableHead>Actor</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Entity</TableHead>
                        <TableHead>Detail</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row) => (
                        <TableRow key={row.id} className="transition-colors hover:bg-accent/40">
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                            {fmtDateTime(row.createdAt)}
                          </TableCell>
                          <TableCell>
                            <div className="min-w-0">
                              <p className="text-sm font-medium leading-tight">{row.actorName}</p>
                              <p className="max-w-40 truncate text-xs text-muted-foreground">
                                {row.actorEmail}
                              </p>
                              <span className="mt-1 inline-block rounded bg-muted px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                {row.actorRole}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={cn('border', actionTone(row.action))}
                              title={actionLabel(row.action)}
                            >
                              {actionLabel(row.action)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div
                              className="min-w-0 max-w-36"
                              title={`${row.entityType}: ${row.entityRef}`}
                            >
                              <p className="truncate font-mono text-xs font-semibold">
                                {row.entityRef}
                              </p>
                              <p className="truncate text-[11px] text-muted-foreground">
                                {row.entityType}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="max-w-52">
                            <p
                              className="truncate text-xs text-muted-foreground"
                              title={row.detail ?? undefined}
                            >
                              {row.detail ?? '—'}
                            </p>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination */}
                <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3">
                  <p className="text-xs text-muted-foreground tabular-nums">
                    Page {safePage} of {safeTotalPages} · {totalCount}{' '}
                    {totalCount === 1 ? 'record' : 'records'}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 focus-visible:ring-primary/30"
                      disabled={safePage <= 1 || loading}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      aria-label="Previous page"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" /> Prev
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 focus-visible:ring-primary/30"
                      disabled={safePage >= safeTotalPages || loading}
                      onClick={() => setPage((p) => Math.min(safeTotalPages, p + 1))}
                      aria-label="Next page"
                    >
                      Next <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
