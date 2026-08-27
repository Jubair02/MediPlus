'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  AlertTriangle,
  BarChart3,
  Bike,
  Download,
  HandCoins,
  Loader2,
  Medal,
  PackageCheck,
  RefreshCw,
  Truck,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { downloadCsv } from '@/lib/download'
import { effectivePrice, fmtBDT, fmtDate, fmtDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Medicine } from '@/lib/types'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface ReportsData {
  salesByDay: { date: string; revenue: number; orders: number }[]
  categorySales: { category: string; qty: number; revenue: number }[]
  topMedicines: { name: string; qty: number; revenue: number }[]
  lowStock: Medicine[]
}

interface DeliveryStaff {
  id: string
  name: string | null
  email: string
  phone: string | null
  assigned: number
  active: number
  delivered: number
  failed: number
  deliveredValue: number
  codCollected: number
  avgCompletionHours: number | null
  lastDeliveryAt: string | null
}

const CHART_GRID = '#e2e8f0'
const AXIS = '#94a3b8'

function shortDay(d: string): string {
  const date = new Date(d)
  if (Number.isNaN(date.getTime())) return d
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function kFmt(v: number): string {
  return Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`
}

function StockChip({ stock }: { stock: number }) {
  if (stock <= 0)
    return (
      <Badge variant="outline" className="border-red-300 bg-red-100 text-red-800">
        Out
      </Badge>
    )
  return (
    <Badge variant="outline" className="border-amber-300 bg-amber-100 text-amber-800">
      Low · {stock}
    </Badge>
  )
}

function RankCell({ idx }: { idx: number }) {
  if (idx === 0) return <Medal className="h-4 w-4 text-amber-500" />
  if (idx === 1) return <Medal className="h-4 w-4 text-gray-400" />
  if (idx === 2) return <Medal className="h-4 w-4 text-amber-700" />
  return <span className="text-xs text-muted-foreground">{idx + 1}</span>
}

function ReportsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-80 w-full rounded-xl" />
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-72 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    </div>
  )
}

function DeliverySkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-2">
          <Skeleton className="h-6 w-52" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-[86px] rounded-xl" />
        ))}
      </div>
      <Card className="gap-0 py-4">
        <CardContent className="px-4">
          <div className="overflow-x-auto scrollbar-thin">
            <Table className="min-w-[820px]">
              <TableHeader>
                <TableRow>
                  {[...Array(9)].map((_, i) => (
                    <TableHead key={i}>
                      <Skeleton className="h-4 w-16" />
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...Array(3)].map((_, i) => (
                  <TableRow key={`sk-${i}`}>
                    <TableCell colSpan={9}>
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
        <span className={cn('flex size-8 items-center justify-center rounded-lg', tone)}>
          {icon}
        </span>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
      </div>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-[11px] text-muted-foreground">{sub}</p>
    </Card>
  )
}

function DeliverySection({
  staff,
  loading,
  error,
  exportPending,
  onRetry,
  onExport,
}: {
  staff: DeliveryStaff[] | null
  loading: boolean
  error: string | null
  exportPending: boolean
  onRetry: () => void
  onExport: () => void
}) {
  const totals = useMemo(() => {
    const list = staff ?? []
    return {
      delivered: list.reduce((sum, s) => sum + s.delivered, 0),
      active: list.reduce((sum, s) => sum + s.active, 0),
      cod: list.reduce((sum, s) => sum + s.codCollected, 0),
      size: list.length,
    }
  }, [staff])

  if (loading && !staff) return <DeliverySkeleton />

  return (
    <div className="space-y-4">
      {/* Section header + toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <Truck className="h-5 w-5 text-primary" aria-hidden="true" /> Delivery performance
          </h2>
          <p className="text-sm text-muted-foreground">How each delivery partner is doing</p>
        </div>
        <Button
          variant="outline"
          onClick={onExport}
          disabled={exportPending || !staff || staff.length === 0}
        >
          {exportPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Export CSV
        </Button>
      </div>

      {error ? (
        <Card className="flex-col items-center gap-2 p-10 text-center">
          <Truck className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </Button>
        </Card>
      ) : !staff || staff.length === 0 ? (
        <Card className="flex-col items-center gap-3 p-10 text-center">
          <Truck className="h-8 w-8 text-muted-foreground/50" />
          <div>
            <p className="text-sm font-medium">No delivery staff yet</p>
            <p className="text-sm text-muted-foreground">
              Delivery partners will appear here once they join the team.
            </p>
          </div>
        </Card>
      ) : (
        <>
          {/* Team summary strip */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatChip
              label="Total delivered"
              value={totals.delivered}
              sub="orders completed by the team"
              tone="bg-emerald-100"
              icon={<PackageCheck className="size-4 text-emerald-700" aria-hidden="true" />}
            />
            <StatChip
              label="Active on the road"
              value={totals.active}
              sub="orders out for delivery"
              tone="bg-teal-100"
              icon={<Bike className="size-4 text-teal-700" aria-hidden="true" />}
            />
            <StatChip
              label="COD collected"
              value={fmtBDT(totals.cod)}
              sub="cash collected on delivery"
              tone="bg-amber-100"
              icon={<HandCoins className="size-4 text-amber-700" aria-hidden="true" />}
            />
            <StatChip
              label="Team size"
              value={totals.size}
              sub="delivery partners"
              tone="bg-primary/10"
              icon={<Users className="text-primary size-4" aria-hidden="true" />}
            />
          </div>

          {/* Staff table */}
          <Card className="gap-0 py-4">
            <CardContent className="px-4">
              <div className="max-h-[60vh] overflow-auto rounded-md border scrollbar-thin">
                <Table className="min-w-[820px]" aria-label="Delivery performance by staff member">
                  <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_var(--border)]">
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Staff</TableHead>
                      <TableHead className="text-center">Assigned</TableHead>
                      <TableHead className="text-center">Active</TableHead>
                      <TableHead className="text-center">Delivered</TableHead>
                      <TableHead className="text-center">Failed</TableHead>
                      <TableHead className="text-center">Success rate</TableHead>
                      <TableHead className="text-right">COD collected</TableHead>
                      <TableHead className="text-right">Avg completion</TableHead>
                      <TableHead className="text-right">Last delivery</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {staff.map((s) => {
                      const hasOrders = s.assigned > 0 || s.delivered > 0
                      const successPct =
                        s.assigned > 0 ? Math.round((s.delivered / s.assigned) * 100) : null
                      const avgH =
                        s.avgCompletionHours != null
                          ? Math.round(s.avgCompletionHours * 10) / 10
                          : null
                      const initial = (s.name?.trim()?.[0] ?? s.email[0] ?? '?').toUpperCase()
                      return (
                        <TableRow
                          key={s.id}
                          className={cn(!hasOrders && 'text-muted-foreground')}
                        >
                          <TableCell>
                            <div className="flex items-center gap-2.5">
                              <Avatar className="size-8">
                                <AvatarFallback className="text-xs">{initial}</AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">{s.name ?? s.email}</p>
                                <p className="max-w-44 truncate text-xs text-muted-foreground">
                                  {s.email}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-center text-sm">
                            {s.assigned}
                          </TableCell>
                          <TableCell className="text-center">
                            {s.active > 0 ? (
                              <Badge
                                variant="outline"
                                className="whitespace-nowrap border-teal-300 bg-teal-100 text-teal-800"
                              >
                                {s.active}
                              </Badge>
                            ) : (
                              <span className="text-sm">0</span>
                            )}
                          </TableCell>
                          <TableCell
                            className={cn(
                              'whitespace-nowrap text-center text-sm',
                              hasOrders && 'font-bold text-emerald-600 dark:text-emerald-400'
                            )}
                          >
                            {s.delivered}
                          </TableCell>
                          <TableCell
                            className={cn(
                              'whitespace-nowrap text-center text-sm',
                              s.failed > 0 && 'font-medium text-red-600 dark:text-red-400'
                            )}
                          >
                            {s.failed}
                          </TableCell>
                          <TableCell>
                            {successPct === null ? (
                              <span className="text-sm text-muted-foreground">—</span>
                            ) : (
                              <div
                                className="flex items-center justify-center gap-2"
                                title={`${successPct}% of assigned orders delivered`}
                              >
                                <Progress
                                  value={successPct}
                                  className="h-1.5 w-16"
                                  aria-label={`${successPct}% success rate`}
                                />
                                <span className="w-9 text-xs font-medium tabular-nums">
                                  {successPct}%
                                </span>
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right text-sm font-medium">
                            {fmtBDT(s.codCollected)}
                          </TableCell>
                          <TableCell
                            className="whitespace-nowrap text-right text-sm"
                            title="Avg hours from order placed to delivered"
                          >
                            {avgH != null ? `${avgH}h` : '—'}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right text-sm">
                            {s.lastDeliveryAt ? (
                              fmtDateTime(s.lastDeliveryAt)
                            ) : (
                              <span className="text-muted-foreground">Never</span>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

export default function AdminReports() {
  const [days, setDays] = useState('7')
  const [reports, setReports] = useState<ReportsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [exportPending, setExportPending] = useState(false)
  const [staff, setStaff] = useState<DeliveryStaff[] | null>(null)
  const [staffLoading, setStaffLoading] = useState(true)
  const [staffError, setStaffError] = useState<string | null>(null)
  const [staffExportPending, setStaffExportPending] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await api<ReportsData>(`/api/admin?resource=reports&days=${days}`)
      setReports(d)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load reports')
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => {
    void load()
  }, [load])

  const loadDelivery = useCallback(async (signal?: AbortSignal) => {
    setStaffLoading(true)
    setStaffError(null)
    try {
      const d = await api<{ staff: DeliveryStaff[] }>(
        '/api/admin?resource=delivery-performance',
        { signal }
      )
      setStaff(d.staff)
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      setStaffError(e instanceof Error ? e.message : 'Failed to load delivery performance')
    } finally {
      setStaffLoading(false)
    }
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    void loadDelivery(ctrl.signal)
    return () => ctrl.abort()
  }, [loadDelivery])

  async function exportCsv() {
    setExportPending(true)
    try {
      const d = await api<{ filename: string; csv: string }>(
        `/api/admin?resource=export-report&days=${days}`
      )
      if (typeof d.csv !== 'string' || typeof d.filename !== 'string')
        throw new Error('Export unavailable')
      downloadCsv(d.filename, d.csv)
      toast.success('Report exported')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to export report')
    } finally {
      setExportPending(false)
    }
  }

  async function exportDeliveryCsv() {
    setStaffExportPending(true)
    try {
      const d = await api<{ filename: string; csv: string }>(
        '/api/admin?resource=export-delivery'
      )
      if (typeof d.csv !== 'string' || typeof d.filename !== 'string')
        throw new Error('Export unavailable')
      downloadCsv(d.filename, d.csv)
      toast.success('Delivery report exported')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to export delivery report')
    } finally {
      setStaffExportPending(false)
    }
  }

  const catHeight = reports ? Math.max(220, reports.categorySales.length * 44 + 40) : 220

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => void exportCsv()} disabled={exportPending}>
          {exportPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Export CSV
        </Button>
      </div>

      {loading && !reports ? (
        <ReportsSkeleton />
      ) : !reports ? (
        <Card className="items-center p-10 text-center">
          <BarChart3 className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">Could not load reports.</p>
        </Card>
      ) : (
        <>
          {/* Charts */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Sales by day</CardTitle>
                <CardDescription>Revenue and order volume</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={reports.salesByDay} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={shortDay}
                      tick={{ fontSize: 11 }}
                      stroke={AXIS}
                    />
                    <YAxis
                      yAxisId="rev"
                      orientation="left"
                      tick={{ fontSize: 11 }}
                      stroke={AXIS}
                      width={48}
                      tickFormatter={kFmt}
                    />
                    <YAxis
                      yAxisId="ord"
                      orientation="right"
                      tick={{ fontSize: 11 }}
                      stroke={AXIS}
                      width={32}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{ borderRadius: 8, fontSize: 12 }}
                      formatter={(v, name) => (name === 'orders' ? `${Number(v)} orders` : fmtBDT(Number(v)))}
                      labelFormatter={(l) => fmtDate(String(l))}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: 12 }}
                      formatter={(v) => (v === 'orders' ? 'Orders' : 'Revenue')}
                    />
                    <Bar
                      yAxisId="rev"
                      dataKey="revenue"
                      fill="#10b981"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={22}
                    />
                    <Bar
                      yAxisId="ord"
                      dataKey="orders"
                      fill="#14b8a6"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={22}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Sales by category</CardTitle>
                <CardDescription>Revenue share per department</CardDescription>
              </CardHeader>
              <CardContent>
                {reports.categorySales.length === 0 ? (
                  <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
                    No sales in this period
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={catHeight}>
                    <BarChart
                      data={reports.categorySales}
                      layout="vertical"
                      margin={{ top: 4, right: 24, left: 8, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} horizontal={false} />
                      <XAxis
                        type="number"
                        tick={{ fontSize: 11 }}
                        stroke={AXIS}
                        tickFormatter={kFmt}
                      />
                      <YAxis
                        type="category"
                        dataKey="category"
                        tick={{ fontSize: 11 }}
                        stroke={AXIS}
                        width={110}
                      />
                      <Tooltip
                        contentStyle={{ borderRadius: 8, fontSize: 12 }}
                        formatter={(v) => fmtBDT(Number(v))}
                      />
                      <Bar dataKey="revenue" fill="#14b8a6" radius={[0, 4, 4, 0]} maxBarSize={18} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Tables */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Top selling medicines</CardTitle>
                <CardDescription>Best performers by units sold</CardDescription>
              </CardHeader>
              <CardContent>
                {reports.topMedicines.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No sales data yet.</p>
                ) : (
                  <div className="max-h-96 overflow-y-auto rounded-md border scrollbar-thin">
                    <Table>
                      <TableHeader className="sticky top-0 bg-card">
                        <TableRow>
                          <TableHead className="w-12">#</TableHead>
                          <TableHead>Medicine</TableHead>
                          <TableHead className="text-center">Units</TableHead>
                          <TableHead className="text-right">Revenue</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {reports.topMedicines.map((m, i) => (
                          <TableRow key={m.name}>
                            <TableCell>
                              <RankCell idx={i} />
                            </TableCell>
                            <TableCell className="max-w-48 truncate text-sm font-medium">{m.name}</TableCell>
                            <TableCell className="text-center text-sm">{m.qty}</TableCell>
                            <TableCell className="text-right font-medium">{fmtBDT(m.revenue)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-500" /> Low stock report
                </CardTitle>
                <CardDescription>Consider restocking these items soon</CardDescription>
              </CardHeader>
              <CardContent>
                {reports.lowStock.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Nothing critical — inventory looks healthy.
                  </p>
                ) : (
                  <div className="max-h-96 overflow-y-auto rounded-md border scrollbar-thin">
                    <Table>
                      <TableHeader className="sticky top-0 bg-card">
                        <TableRow>
                          <TableHead>Medicine</TableHead>
                          <TableHead className="text-center">Stock</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead className="text-right">Price</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {reports.lowStock.map((m) => (
                          <TableRow key={m.id}>
                            <TableCell className="max-w-44 truncate text-sm font-medium">{m.name}</TableCell>
                            <TableCell className="text-center">
                              <StockChip stock={m.stock} />
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {m.category?.name ?? 'Uncategorized'}
                            </TableCell>
                            <TableCell className="text-right text-sm">{fmtBDT(effectivePrice(m))}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* Delivery performance */}
      <DeliverySection
        staff={staff}
        loading={staffLoading}
        error={staffError}
        exportPending={staffExportPending}
        onRetry={() => void loadDelivery()}
        onExport={() => void exportDeliveryCsv()}
      />
    </div>
  )
}
