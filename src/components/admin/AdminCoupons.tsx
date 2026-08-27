'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BadgeCheck,
  CalendarX2,
  HandCoins,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Repeat2,
  Ticket,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { fmtBDT, fmtDate } from '@/lib/format'
import { cn } from '@/lib/utils'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

// Matches GET /api/admin?resource=coupons + admin coupon mutations (Task 6-a contract)
export interface AdminCoupon {
  id: string
  code: string
  type: 'PERCENT' | 'FIXED'
  value: number
  minAmount: number
  maxDiscount: number | null
  isActive: boolean
  expiresAt: string | null
  createdAt: string
  usedCount: number
  discountAmount: number
}

interface FormState {
  code: string
  type: 'PERCENT' | 'FIXED'
  value: string
  minAmount: string
  maxDiscount: string
  expiresAt: string
  isActive: boolean
}

const EMPTY_FORM: FormState = {
  code: '',
  type: 'PERCENT',
  value: '',
  minAmount: '0',
  maxDiscount: '',
  expiresAt: '',
  isActive: true,
}

function isExpired(c: Pick<AdminCoupon, 'expiresAt'>): boolean {
  return !!c.expiresAt && new Date(c.expiresAt).getTime() < Date.now()
}

function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '')
}

/** Client-side mirror of the server validation for create/update coupon */
function validate(f: FormState): string | null {
  if (!f.code.trim()) return 'Coupon code is required'
  if (f.code.trim().length < 3) return 'Coupon code must be at least 3 characters'
  const value = Number(f.value)
  if (f.value.trim() === '' || Number.isNaN(value) || value <= 0) return 'Value must be greater than 0'
  if (f.type === 'PERCENT' && value > 90) return 'Percentage discount cannot exceed 90%'
  const minAmount = Number(f.minAmount || 0)
  if (Number.isNaN(minAmount) || minAmount < 0) return 'Minimum order amount must be 0 or more'
  if (f.type === 'PERCENT' && f.maxDiscount.trim() !== '') {
    const cap = Number(f.maxDiscount)
    if (Number.isNaN(cap) || cap <= 0) return 'Max discount must be greater than 0'
  }
  return null
}

function toPayload(f: FormState) {
  return {
    code: f.code.trim().toUpperCase(),
    type: f.type,
    value: Number(f.value),
    minAmount: Number(f.minAmount || 0),
    maxDiscount:
      f.type === 'PERCENT' && f.maxDiscount.trim() !== '' ? Number(f.maxDiscount) : null,
    expiresAt: f.expiresAt || null,
    isActive: f.isActive,
  }
}

// ---------- Shared create / edit dialog ----------

function CouponDialog({
  open,
  onOpenChange,
  initial,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial: AdminCoupon | null
  onSaved: () => void
}) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setForm(
        initial
          ? {
              code: initial.code,
              type: initial.type,
              value: String(initial.value),
              minAmount: String(initial.minAmount ?? 0),
              maxDiscount: initial.maxDiscount != null ? String(initial.maxDiscount) : '',
              expiresAt: initial.expiresAt ? initial.expiresAt.slice(0, 10) : '',
              isActive: initial.isActive,
            }
          : EMPTY_FORM
      )
      setError(null)
    }
  }, [open, initial])

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function save() {
    const problem = validate(form)
    if (problem) {
      setError(problem)
      return
    }
    setSaving(true)
    try {
      if (initial) {
        await api<{ coupon: AdminCoupon }>('/api/admin', {
          method: 'PUT',
          body: { action: 'update-coupon', id: initial.id, coupon: toPayload(form) },
        })
        toast.success('Coupon updated')
      } else {
        await api<{ coupon: AdminCoupon }>('/api/admin', {
          method: 'PUT',
          body: { action: 'create-coupon', coupon: toPayload(form) },
        })
        toast.success('Coupon created')
      }
      onOpenChange(false)
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save coupon')
    } finally {
      setSaving(false)
    }
  }

  const today = new Date().toISOString().slice(0, 10)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit coupon' : 'New coupon'}</DialogTitle>
          <DialogDescription>
            Customers can apply the code at checkout; usage is tracked automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="coupon-code">Code *</Label>
            <Input
              id="coupon-code"
              value={form.code}
              onChange={(e) => set('code', e.target.value.toUpperCase())}
              placeholder="SAVE20"
              maxLength={20}
              className="font-mono uppercase"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="coupon-type">Type</Label>
            <Select value={form.type} onValueChange={(v) => set('type', v as FormState['type'])}>
              <SelectTrigger id="coupon-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PERCENT">Percentage off</SelectItem>
                <SelectItem value="FIXED">Fixed amount</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="coupon-value">Value *</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                  {form.type === 'PERCENT' ? '%' : '৳'}
                </span>
                <Input
                  id="coupon-value"
                  type="number"
                  min={0}
                  step="any"
                  value={form.value}
                  onChange={(e) => set('value', e.target.value)}
                  placeholder={form.type === 'PERCENT' ? '20' : '100'}
                  className="pl-7"
                />
              </div>
              {form.type === 'PERCENT' && (
                <p className="text-[11px] text-muted-foreground">Max 90%</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="coupon-min">Min order (৳)</Label>
              <Input
                id="coupon-min"
                type="number"
                min={0}
                step="any"
                value={form.minAmount}
                onChange={(e) => set('minAmount', e.target.value)}
                placeholder="0"
              />
            </div>
          </div>
          {form.type === 'PERCENT' && (
            <div className="space-y-1.5">
              <Label htmlFor="coupon-cap">Max discount (৳)</Label>
              <Input
                id="coupon-cap"
                type="number"
                min={0}
                step="any"
                value={form.maxDiscount}
                onChange={(e) => set('maxDiscount', e.target.value)}
                placeholder="No cap"
              />
              <p className="text-[11px] text-muted-foreground">
                Caps the discount for percentage coupons. Leave empty for no cap.
              </p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="coupon-expiry">Expires on</Label>
            <Input
              id="coupon-expiry"
              type="date"
              min={today}
              value={form.expiresAt}
              onChange={(e) => set('expiresAt', e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">Optional — coupon never expires if empty</p>
          </div>
          {initial && (
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">
                  Inactive coupons are rejected at checkout
                </p>
              </div>
              <Switch
                checked={form.isActive}
                onCheckedChange={(v) => set('isActive', v)}
                aria-label="Toggle coupon active"
              />
            </div>
          )}
          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {initial ? 'Save changes' : 'Create coupon'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- Main view ----------

export default function AdminCoupons() {
  const [coupons, setCoupons] = useState<AdminCoupon[]>([])
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<AdminCoupon | null>(null)
  const [rowPending, setRowPending] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deletePending, setDeletePending] = useState(false)

  const load = useCallback(async () => {
    setFetching(true)
    setError(null)
    try {
      const d = await api<{ coupons: AdminCoupon[] }>('/api/admin?resource=coupons')
      setCoupons(d.coupons)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load coupons')
    } finally {
      setLoading(false)
      setFetching(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const stats = useMemo(() => {
    const now = Date.now()
    let active = 0
    let inactive = 0
    let expired = 0
    let redemptions = 0
    let given = 0
    for (const c of coupons) {
      if (c.expiresAt && new Date(c.expiresAt).getTime() < now) expired++
      if (c.isActive) active++
      else inactive++
      redemptions += c.usedCount
      given += c.discountAmount
    }
    return { active, inactive, expired, redemptions, given }
  }, [coupons])

  async function toggleActive(c: AdminCoupon, next: boolean) {
    setRowPending(c.id)
    setCoupons((prev) => prev.map((x) => (x.id === c.id ? { ...x, isActive: next } : x))) // optimistic
    try {
      await api('/api/admin', {
        method: 'PUT',
        body: { action: 'update-coupon', id: c.id, coupon: { isActive: next } },
      })
      toast.success(`Coupon ${c.code} ${next ? 'activated' : 'deactivated'}`)
    } catch (e) {
      setCoupons((prev) => prev.map((x) => (x.id === c.id ? { ...x, isActive: c.isActive } : x))) // revert
      toast.error(e instanceof Error ? e.message : 'Failed to update coupon')
    } finally {
      setRowPending(null)
    }
  }

  async function remove() {
    if (!deleteId) return
    setDeletePending(true)
    try {
      await api('/api/admin', { method: 'PUT', body: { action: 'delete-coupon', id: deleteId } })
      const target = coupons.find((c) => c.id === deleteId)
      setCoupons((prev) => prev.filter((c) => c.id !== deleteId))
      toast.success(`Coupon ${target?.code ?? ''} deleted`)
      setDeleteId(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete coupon')
    } finally {
      setDeletePending(false)
    }
  }

  const deleteTarget = coupons.find((c) => c.id === deleteId) ?? null

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={() => void load()}
          aria-label="Refresh coupons"
          title="Refresh"
          disabled={fetching}
        >
          <RefreshCw className={cn('h-4 w-4', fetching && 'animate-spin')} />
        </Button>
        <Button
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
        >
          <Plus className="h-4 w-4" /> New coupon
        </Button>
      </div>

      {/* Summary chips */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="gap-1 p-4">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-emerald-100">
              <BadgeCheck className="size-4 text-emerald-700" aria-hidden="true" />
            </span>
            <p className="text-xs font-medium text-muted-foreground">Active</p>
          </div>
          <p className="text-2xl font-bold tabular-nums">{stats.active}</p>
          <p className="text-[11px] text-muted-foreground">{stats.inactive} inactive</p>
        </Card>
        <Card className="gap-1 p-4">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-red-100">
              <CalendarX2 className="size-4 text-red-700" aria-hidden="true" />
            </span>
            <p className="text-xs font-medium text-muted-foreground">Expired</p>
          </div>
          <p className="text-2xl font-bold tabular-nums">{stats.expired}</p>
          <p className="text-[11px] text-muted-foreground">past their end date</p>
        </Card>
        <Card className="gap-1 p-4">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-teal-100">
              <Repeat2 className="size-4 text-teal-700" aria-hidden="true" />
            </span>
            <p className="text-xs font-medium text-muted-foreground">Redemptions</p>
          </div>
          <p className="text-2xl font-bold tabular-nums">{stats.redemptions}</p>
          <p className="text-[11px] text-muted-foreground">total times used</p>
        </Card>
        <Card className="gap-1 p-4">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-amber-100">
              <HandCoins className="size-4 text-amber-700" aria-hidden="true" />
            </span>
            <p className="text-xs font-medium text-muted-foreground">Discount given</p>
          </div>
          <p className="text-2xl font-bold tabular-nums">{fmtBDT(stats.given)}</p>
          <p className="text-[11px] text-muted-foreground">across all coupons</p>
        </Card>
      </div>

      {/* Table */}
      {loading ? (
        <Card className="gap-0 py-4">
          <CardContent className="px-4">
            <div className="overflow-x-auto scrollbar-thin">
              <Table className="min-w-[720px]">
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
                  {[...Array(4)].map((_, i) => (
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
      ) : error ? (
        <Card className="flex-col items-center gap-2 p-10 text-center">
          <Ticket className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </Button>
        </Card>
      ) : coupons.length === 0 ? (
        <Card className="flex-col items-center gap-3 p-10 text-center">
          <Ticket className="h-8 w-8 text-muted-foreground/50" />
          <div>
            <p className="text-sm font-medium">No coupons yet</p>
            <p className="text-sm text-muted-foreground">
              Create a discount campaign to reward your customers.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => {
              setEditing(null)
              setDialogOpen(true)
            }}
          >
            <Plus className="h-4 w-4" /> Create coupon
          </Button>
        </Card>
      ) : (
        <Card className="gap-0 py-4">
          <CardContent className="px-4">
            <div className="max-h-[60vh] overflow-auto scrollbar-thin">
              <Table className="min-w-[720px]">
                <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_var(--border)]">
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Code</TableHead>
                    <TableHead>Discount</TableHead>
                    <TableHead className="text-right">Min order</TableHead>
                    <TableHead className="text-right">Cap</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="text-right">Used</TableHead>
                    <TableHead className="text-right">Given</TableHead>
                    <TableHead className="text-center">Active</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {coupons.map((c) => {
                    const expired = isExpired(c)
                    return (
                      <TableRow
                        key={c.id}
                        className={cn('transition-colors hover:bg-accent/40', expired && 'opacity-60')}
                      >
                        <TableCell>
                          <span className="font-mono text-sm font-bold uppercase">{c.code}</span>
                        </TableCell>
                        <TableCell>
                          {c.type === 'PERCENT' ? (
                            <Badge
                              variant="outline"
                              className="border-emerald-300 bg-emerald-100 text-emerald-800"
                            >
                              {trimNum(c.value)}% off
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="border-teal-300 bg-teal-100 text-teal-800"
                            >
                              {fmtBDT(c.value)} off
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right text-sm">
                          {c.minAmount > 0 ? (
                            fmtBDT(c.minAmount)
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right text-sm">
                          {c.type === 'PERCENT' && c.maxDiscount != null ? (
                            fmtBDT(c.maxDiscount)
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          <span className={cn(!c.expiresAt && 'text-muted-foreground')}>
                            {c.expiresAt ? fmtDate(c.expiresAt) : 'Never'}
                          </span>
                          {expired && (
                            <Badge
                              variant="outline"
                              className="ml-1.5 border-red-300 bg-red-100 px-1 py-0 text-[10px] text-red-800"
                            >
                              Expired
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right text-sm">
                          <span className="font-medium tabular-nums">{c.usedCount}</span>{' '}
                          <span className="text-xs text-muted-foreground">
                            redemption{c.usedCount === 1 ? '' : 's'}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right text-sm">
                          {fmtBDT(c.discountAmount)}
                        </TableCell>
                        <TableCell className="text-center">
                          <Switch
                            checked={c.isActive}
                            disabled={rowPending === c.id}
                            onCheckedChange={(v) => void toggleActive(c, v)}
                            aria-label={`Toggle ${c.code}`}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => {
                                setEditing(c)
                                setDialogOpen(true)
                              }}
                              title={`Edit ${c.code}`}
                              aria-label={`Edit ${c.code}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-red-600 hover:bg-red-50 hover:text-red-700"
                              onClick={() => setDeleteId(c.id)}
                              title={`Delete ${c.code}`}
                              aria-label={`Delete ${c.code}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
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
      )}

      <CouponDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initial={editing}
        onSaved={() => void load()}
      />

      {/* Delete confirm */}
      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete coupon?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `"${deleteTarget.code}" will no longer be redeemable at checkout. This cannot be undone.`
                : 'This coupon will be permanently removed.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={deletePending}
              onClick={() => void remove()}
            >
              {deletePending && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
