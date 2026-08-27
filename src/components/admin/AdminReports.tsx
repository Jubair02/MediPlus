'use client'

import { useCallback, useEffect, useState } from 'react'
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
import { AlertTriangle, BarChart3, Medal } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { effectivePrice, fmtBDT, fmtDate } from '@/lib/format'
import type { Medicine } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface ReportsData {
  salesByDay: { date: string; revenue: number; orders: number }[]
  categorySales: { category: string; qty: number; revenue: number }[]
  topMedicines: { name: string; qty: number; revenue: number }[]
  lowStock: Medicine[]
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

export default function AdminReports() {
  const [days, setDays] = useState('7')
  const [reports, setReports] = useState<ReportsData | null>(null)
  const [loading, setLoading] = useState(true)

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

  if (loading && !reports) return <ReportsSkeleton />
  if (!reports) {
    return (
      <Card className="items-center p-10 text-center">
        <BarChart3 className="h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">Could not load reports.</p>
      </Card>
    )
  }

  const catHeight = Math.max(220, reports.categorySales.length * 44 + 40)

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Toolbar */}
      <div className="flex justify-end">
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
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
      <div className="grid gap-4 lg:grid-cols-2">
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
    </div>
  )
}
