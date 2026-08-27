'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  ClipboardList,
  FileCheck,
  MessageSquareHeart,
  ShoppingBag,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { fmtBDT, fmtDate } from '@/lib/format'
import { ORDER_STATUS_LABELS, type AdminStats, type OrderStatus } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const STATUS_COLORS: Record<string, string> = {
  PENDING: '#f59e0b',
  PRESCRIPTION_REVIEW: '#f59e0b',
  CONFIRMED: '#10b981',
  PROCESSING: '#14b8a6',
  OUT_FOR_DELIVERY: '#84cc16',
  DELIVERED: '#10b981',
  CANCELLED: '#94a3b8',
  FAILED: '#ef4444',
}

const STATUS_TONES: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800 border-amber-300',
  PRESCRIPTION_REVIEW: 'bg-amber-50 text-amber-800 border-amber-400',
  CONFIRMED: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  PROCESSING: 'bg-teal-100 text-teal-800 border-teal-300',
  OUT_FOR_DELIVERY: 'bg-emerald-700 text-white border-emerald-700',
  DELIVERED: 'bg-emerald-600 text-white border-emerald-600',
  CANCELLED: 'bg-gray-100 text-gray-600 border-gray-300',
  FAILED: 'bg-red-100 text-red-800 border-red-300',
}

function StatusBadge({ status }: { status: string }) {
  const outline = status === 'PRESCRIPTION_REVIEW'
  return (
    <Badge
      variant={outline ? 'outline' : 'default'}
      className={`border ${STATUS_TONES[status] ?? 'bg-gray-100 text-gray-600 border-gray-300'}`}
    >
      {ORDER_STATUS_LABELS[status as OrderStatus] ?? status}
    </Badge>
  )
}

function shortDay(d: string): string {
  const date = new Date(d)
  if (Number.isNaN(date.getTime())) return d
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

interface StatCardProps {
  icon: LucideIcon
  bgClass: string
  iconClass: string
  label: string
  value: string
  hint: string
}

function StatCard({ icon: Icon, bgClass, iconClass, label, value, hint }: StatCardProps) {
  return (
    <Card className="gap-1.5 p-4 transition-shadow hover:shadow-md">
      <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${bgClass}`}>
        <Icon className={`h-4.5 w-4.5 ${iconClass}`} />
      </div>
      <div>
        <p className="text-2xl font-bold tracking-tight">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
      <p className="text-[11px] text-muted-foreground/80">{hint}</p>
    </Card>
  )
}

function OverviewSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {[...Array(7)].map((_, i) => (
          <Skeleton key={i} className="h-32 w-full rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <Skeleton className="h-80 w-full rounded-xl lg:col-span-3" />
        <Skeleton className="h-80 w-full rounded-xl lg:col-span-2" />
      </div>
      <Skeleton className="h-72 w-full rounded-xl" />
    </div>
  )
}

export default function AdminOverview({ onViewAllOrders }: { onViewAllOrders: () => void }) {
  const user = useAppStore((s) => s.user)
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const d = await api<{ stats: AdminStats }>('/api/admin?resource=stats')
      setStats(d.stats)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load dashboard stats')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void load()
  }, [load])

  if (loading && !stats) return <OverviewSkeleton />
  if (!stats) {
    return (
      <Card className="items-center p-10 text-center">
        <AlertTriangle className="h-8 w-8 text-amber-500" />
        <p className="text-sm text-muted-foreground">Could not load dashboard stats.</p>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          Try again
        </Button>
      </Card>
    )
  }

  const revenueByDay = stats.revenueByDay ?? []
  const lastDay = revenueByDay.length > 0 ? revenueByDay[revenueByDay.length - 1] : null
  const pieData = (stats.statusCounts ?? [])
    .filter((s) => s.count > 0)
    .map((s) => ({
      name: ORDER_STATUS_LABELS[s.status as OrderStatus] ?? s.status,
      value: s.count,
      status: s.status,
    }))

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <StatCard
          icon={Users}
          bgClass="bg-emerald-100"
          iconClass="text-emerald-700"
          label="Total Users"
          value={String(stats.totalUsers)}
          hint="Customers, pharmacists & staff"
        />
        <StatCard
          icon={ShoppingBag}
          bgClass="bg-teal-100"
          iconClass="text-teal-700"
          label="Total Orders"
          value={String(stats.totalOrders)}
          hint={`${stats.pendingOrders} pending right now`}
        />
        <StatCard
          icon={Banknote}
          bgClass="bg-lime-100"
          iconClass="text-emerald-700"
          label="Revenue"
          value={fmtBDT(stats.totalRevenue)}
          hint={lastDay ? `${fmtBDT(lastDay.revenue)} in the last day` : 'No sales yet'}
        />
        <StatCard
          icon={ClipboardList}
          bgClass="bg-amber-100"
          iconClass="text-amber-600"
          label="Pending Orders"
          value={String(stats.pendingOrders)}
          hint="Need confirmation or processing"
        />
        <StatCard
          icon={FileCheck}
          bgClass="bg-amber-100"
          iconClass="text-amber-600"
          label="Pending Prescriptions"
          value={String(stats.pendingPrescriptions)}
          hint="Waiting for pharmacist review"
        />
        <StatCard
          icon={AlertTriangle}
          bgClass="bg-red-100"
          iconClass="text-red-600"
          label="Low Stock Items"
          value={String(stats.lowStockCount)}
          hint="Restock recommended"
        />
        <StatCard
          icon={MessageSquareHeart}
          bgClass="bg-teal-100"
          iconClass="text-teal-700"
          label="Reviews"
          value={String(stats.totalReviews ?? 0)}
          hint={
            stats.avgRating != null
              ? `★ ${stats.avgRating.toFixed(1)} average rating`
              : 'No reviews yet'
          }
        />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="min-w-0 lg:col-span-3">
          <CardHeader>
            <CardTitle>Revenue trend</CardTitle>
            <CardDescription>Daily gross revenue</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={revenueByDay} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="adminRevFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={shortDay}
                  tick={{ fontSize: 11 }}
                  stroke="#94a3b8"
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  stroke="#94a3b8"
                  width={48}
                  tickFormatter={(v) => (Number(v) >= 1000 ? `${Math.round(Number(v) / 1000)}k` : `${v}`)}
                />
                <Tooltip
                  contentStyle={{ borderRadius: 8, fontSize: 12 }}
                  formatter={(v) => [fmtBDT(Number(v)), 'Revenue']}
                  labelFormatter={(l) => fmtDate(String(l))}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#adminRevFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="min-w-0 lg:col-span-2">
          <CardHeader>
            <CardTitle>Order statuses</CardTitle>
            <CardDescription>Distribution across the pipeline</CardDescription>
          </CardHeader>
          <CardContent>
            {pieData.length === 0 ? (
              <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
                No orders yet
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={2}
                  >
                    {pieData.map((entry) => (
                      <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? '#94a3b8'} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ borderRadius: 8, fontSize: 12 }}
                    formatter={(v) => `${Number(v)} orders`}
                  />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent orders + low stock */}
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="min-w-0 lg:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="space-y-1">
              <CardTitle>Recent orders</CardTitle>
              <CardDescription>The latest activity in the store</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={onViewAllOrders}>
              View all <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </CardHeader>
          <CardContent>
            {(stats.recentOrders ?? []).length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No orders yet.</p>
            ) : (
              <div className="max-h-96 overflow-auto rounded-md border scrollbar-thin">
                <Table>
                  <TableHeader className="sticky top-0 bg-card">
                    <TableRow>
                      <TableHead>Order</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.recentOrders.map((o) => (
                      <TableRow key={o.id}>
                        <TableCell className="font-mono text-xs font-medium">{o.orderNo}</TableCell>
                        <TableCell className="max-w-36 truncate">
                          {o.user?.name ?? o.address?.recipient ?? '—'}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-medium">
                          {fmtBDT(o.total)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={o.status} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {fmtDate(o.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0 lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" /> Low stock
            </CardTitle>
            <CardDescription>Items running low — restock soon</CardDescription>
          </CardHeader>
          <CardContent>
            {(stats.lowStock ?? []).length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                All stocked up. Nothing critical.
              </p>
            ) : (
              <ul className="max-h-96 space-y-2 overflow-y-auto scrollbar-thin">
                {stats.lowStock.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between gap-3 rounded-lg border p-2.5 transition-colors hover:bg-accent/50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{m.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {m.category?.name ?? 'Uncategorized'}
                      </p>
                    </div>
                    {m.stock <= 0 ? (
                      <Badge variant="outline" className="border-red-300 bg-red-100 text-red-800">
                        Out
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-amber-300 bg-amber-100 text-amber-800">
                        Low · {m.stock}
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
