'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Minus, PackageSearch, Pencil, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { effectivePrice, fmtBDT, fmtDate } from '@/lib/format'
import type { Category, Medicine } from '@/lib/types'
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
import { Textarea } from '@/components/ui/textarea'
import MedImage from './MedImage'

const UNITS = ['piece', 'strip', 'bottle', 'box', 'tube'] as const

interface FormState {
  name: string
  genericName: string
  brand: string
  manufacturer: string
  description: string
  categoryId: string
  price: string
  discountPrice: string
  stock: string
  unit: string
  requiresPrescription: boolean
  expiryDate: string
  image: string
  status: 'ACTIVE' | 'INACTIVE'
}

const EMPTY_FORM: FormState = {
  name: '',
  genericName: '',
  brand: '',
  manufacturer: '',
  description: '',
  categoryId: '',
  price: '',
  discountPrice: '',
  stock: '',
  unit: 'piece',
  requiresPrescription: false,
  expiryDate: '',
  image: '',
  status: 'ACTIVE',
}

function toForm(m: Medicine): FormState {
  return {
    name: m.name,
    genericName: m.genericName ?? '',
    brand: m.brand ?? '',
    manufacturer: m.manufacturer ?? '',
    description: m.description ?? '',
    categoryId: m.categoryId ?? '',
    price: String(m.price),
    discountPrice: m.discountPrice ? String(m.discountPrice) : '',
    stock: String(m.stock),
    unit: m.unit || 'piece',
    requiresPrescription: m.requiresPrescription,
    expiryDate: m.expiryDate ? m.expiryDate.slice(0, 10) : '',
    image: m.image ?? '',
    status: m.status,
  }
}

function validate(f: FormState): string | null {
  if (!f.name.trim()) return 'Medicine name is required'
  const price = Number(f.price)
  if (!f.price || Number.isNaN(price) || price <= 0) return 'Price must be greater than 0'
  const stock = Number(f.stock)
  if (f.stock === '' || Number.isNaN(stock) || stock < 0) return 'Stock must be 0 or more'
  if (f.discountPrice.trim() !== '') {
    const d = Number(f.discountPrice)
    if (Number.isNaN(d) || d < 0) return 'Discount price must be 0 or more'
    if (d >= price) return 'Discount price must be lower than the regular price'
  }
  return null
}

function StockChip({ stock }: { stock: number }) {
  if (stock <= 0)
    return (
      <Badge variant="outline" className="border-gray-300 bg-gray-100 text-gray-600">
        Out
      </Badge>
    )
  if (stock <= 10)
    return (
      <Badge variant="outline" className="border-red-300 bg-red-100 text-red-800">
        Low
      </Badge>
    )
  return (
    <Badge variant="outline" className="border-emerald-300 bg-emerald-100 text-emerald-800">
      In
    </Badge>
  )
}

interface MedicineDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  categories: Category[]
  initial: Medicine | null
  onSaved: () => void
}

function MedicineDialog({ open, onOpenChange, categories, initial, onSaved }: MedicineDialogProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setForm(initial ? toForm(initial) : EMPTY_FORM)
      setError(null)
    }
  }, [open, initial])

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function save() {
    const err = validate(form)
    if (err) {
      setError(err)
      return
    }
    setSaving(true)
    try {
      const data = {
        name: form.name.trim(),
        genericName: form.genericName.trim() || null,
        brand: form.brand.trim() || null,
        manufacturer: form.manufacturer.trim() || null,
        description: form.description.trim() || null,
        categoryId: form.categoryId || null,
        price: Number(form.price),
        discountPrice: form.discountPrice.trim() === '' ? null : Number(form.discountPrice),
        stock: Number(form.stock),
        unit: form.unit,
        requiresPrescription: form.requiresPrescription,
        expiryDate: form.expiryDate || null,
        image: form.image.trim() || null,
        status: form.status,
      }
      const body = initial
        ? { action: 'update-medicine', id: initial.id, data }
        : { action: 'create-medicine', data }
      await api<{ medicine: Medicine }>('/api/pharmacist', { method: 'PUT', body })
      toast.success(initial ? 'Medicine updated' : 'Medicine created')
      onOpenChange(false)
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save medicine')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto scrollbar-thin sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit medicine' : 'Add medicine'}</DialogTitle>
          <DialogDescription>
            {initial ? 'Update catalog details, pricing and stock.' : 'Create a new catalog item.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="pmed-name">Name *</Label>
            <Input
              id="pmed-name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Napa Extra 500mg"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pmed-generic">Generic name</Label>
            <Input
              id="pmed-generic"
              value={form.genericName}
              onChange={(e) => set('genericName', e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pmed-brand">Brand</Label>
            <Input id="pmed-brand" value={form.brand} onChange={(e) => set('brand', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pmed-manufacturer">Manufacturer</Label>
            <Input
              id="pmed-manufacturer"
              value={form.manufacturer}
              onChange={(e) => set('manufacturer', e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pmed-category">Category</Label>
            <Select
              value={form.categoryId || 'NONE'}
              onValueChange={(v) => set('categoryId', v === 'NONE' ? '' : v)}
            >
              <SelectTrigger id="pmed-category" className="w-full">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">No category</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pmed-price">Price (৳) *</Label>
            <Input
              id="pmed-price"
              type="number"
              min={0}
              step="0.01"
              value={form.price}
              onChange={(e) => set('price', e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pmed-discount">Discount price (৳)</Label>
            <Input
              id="pmed-discount"
              type="number"
              min={0}
              step="0.01"
              value={form.discountPrice}
              onChange={(e) => set('discountPrice', e.target.value)}
              placeholder="Leave empty for no discount"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pmed-stock">Stock *</Label>
            <Input
              id="pmed-stock"
              type="number"
              min={0}
              step="1"
              value={form.stock}
              onChange={(e) => set('stock', e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pmed-unit">Unit</Label>
            <Select value={form.unit} onValueChange={(v) => set('unit', v)}>
              <SelectTrigger id="pmed-unit" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UNITS.map((u) => (
                  <SelectItem key={u} value={u}>
                    {u}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pmed-expiry">Expiry date</Label>
            <Input
              id="pmed-expiry"
              type="date"
              value={form.expiryDate}
              onChange={(e) => set('expiryDate', e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pmed-image">Image URL</Label>
            <Input
              id="pmed-image"
              value={form.image}
              onChange={(e) => set('image', e.target.value)}
              placeholder="/images/med-1.png or https://..."
            />
            <p className="text-[11px] text-muted-foreground">Leave empty for placeholder</p>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3 sm:col-span-2">
            <div>
              <p className="text-sm font-medium">Requires prescription</p>
              <p className="text-xs text-muted-foreground">
                Orders with this item wait for pharmacist approval
              </p>
            </div>
            <Switch
              checked={form.requiresPrescription}
              onCheckedChange={(v) => set('requiresPrescription', v)}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3 sm:col-span-2">
            <div>
              <p className="text-sm font-medium">Status</p>
              <p className="text-xs text-muted-foreground">
                Inactive items are hidden from the storefront
              </p>
            </div>
            <Switch
              checked={form.status === 'ACTIVE'}
              onCheckedChange={(v) => set('status', v ? 'ACTIVE' : 'INACTIVE')}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="pmed-description">Description</Label>
            <Textarea
              id="pmed-description"
              rows={3}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>
        </div>

        {error && <p className="text-sm font-medium text-red-600">{error}</p>}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {initial ? 'Save changes' : 'Create medicine'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function PharmacistMedicines() {
  const [meds, setMeds] = useState<Medicine[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Medicine | null>(null)
  const [rowPending, setRowPending] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [m, c] = await Promise.all([
        api<{ medicines: Medicine[] }>('/api/pharmacist?resource=medicines'),
        api<{ categories: Category[] }>('/api/categories'),
      ])
      setMeds(m.medicines)
      setCategories(c.categories)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load medicines')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return meds
    return meds.filter((m) =>
      `${m.name} ${m.genericName ?? ''} ${m.brand ?? ''}`.toLowerCase().includes(q)
    )
  }, [meds, search])

  async function adjustStock(m: Medicine, delta: number) {
    const next = Math.max(0, m.stock + delta)
    if (next === m.stock) return
    setRowPending(m.id)
    try {
      const d = await api<{ medicine: Medicine }>('/api/pharmacist', {
        method: 'PUT',
        body: { action: 'update-medicine', id: m.id, data: { stock: next } },
      })
      setMeds((prev) => prev.map((x) => (x.id === m.id ? d.medicine : x)))
      toast.success(`${m.name}: stock updated to ${d.medicine.stock}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update stock')
    } finally {
      setRowPending(null)
    }
  }

  async function toggleStatus(m: Medicine, next: boolean) {
    setRowPending(m.id)
    try {
      await api('/api/pharmacist', {
        method: 'PUT',
        body: { action: 'update-medicine', id: m.id, data: { status: next ? 'ACTIVE' : 'INACTIVE' } },
      })
      setMeds((prev) =>
        prev.map((x) => (x.id === m.id ? { ...x, status: next ? 'ACTIVE' : 'INACTIVE' } : x))
      )
      toast.success(`${m.name} is now ${next ? 'ACTIVE' : 'INACTIVE'}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update status')
    } finally {
      setRowPending(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, generic or brand"
            className="pl-8"
          />
        </div>
        <div className="sm:ml-auto">
          <Button
            onClick={() => {
              setEditing(null)
              setDialogOpen(true)
            }}
          >
            <Plus className="h-4 w-4" /> Add Medicine
          </Button>
        </div>
      </div>

      {/* Table */}
      <Card className="gap-0 py-4">
        <CardContent className="px-4">
          <div className="overflow-x-auto scrollbar-thin">
            <Table className="min-w-[880px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Medicine</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-center">Stock</TableHead>
                  <TableHead className="text-center">Rx</TableHead>
                  <TableHead className="text-center">Active</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead className="text-right">Edit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  [...Array(6)].map((_, i) => (
                    <TableRow key={`sk-${i}`}>
                      <TableCell colSpan={8}>
                        <Skeleton className="h-10 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8}>
                      <div className="flex flex-col items-center gap-2 py-10 text-center">
                        <PackageSearch className="h-8 w-8 text-muted-foreground/50" />
                        <p className="text-sm text-muted-foreground">No medicines found.</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((m) => {
                    const expired = m.expiryDate ? new Date(m.expiryDate) < new Date() : false
                    return (
                      <TableRow key={m.id} className="transition-colors hover:bg-accent/40">
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <MedImage src={m.image} alt={m.name} className="h-10 w-10 rounded" />
                            <div className="min-w-0">
                              <p className="max-w-52 truncate text-sm font-medium">{m.name}</p>
                              {m.genericName && (
                                <p className="max-w-52 truncate text-xs text-muted-foreground">
                                  {m.genericName}
                                </p>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{m.category?.name ?? 'Uncategorized'}</Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right">
                          <span className="font-medium">{fmtBDT(effectivePrice(m))}</span>
                          {m.discountPrice && m.discountPrice < m.price ? (
                            <span className="ml-1.5 text-xs text-muted-foreground line-through">
                              {fmtBDT(m.price)}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-6 w-6"
                              disabled={rowPending === m.id || m.stock <= 0}
                              onClick={() => void adjustStock(m, -1)}
                              title={`Decrease stock of ${m.name}`}
                              aria-label={`Decrease stock of ${m.name}`}
                            >
                              <Minus className="h-3 w-3" />
                            </Button>
                            <span className="w-8 text-center text-sm font-medium">{m.stock}</span>
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-6 w-6"
                              disabled={rowPending === m.id}
                              onClick={() => void adjustStock(m, 1)}
                              title={`Increase stock of ${m.name}`}
                              aria-label={`Increase stock of ${m.name}`}
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                          </div>
                          <div className="mt-1 flex justify-center">
                            <StockChip stock={m.stock} />
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          {m.requiresPrescription ? (
                            <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
                              Rx
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <Switch
                            checked={m.status === 'ACTIVE'}
                            disabled={rowPending === m.id}
                            onCheckedChange={(v) => void toggleStatus(m, v)}
                            aria-label={`Toggle ${m.name}`}
                          />
                        </TableCell>
                        <TableCell
                          className={`whitespace-nowrap text-xs ${expired ? 'font-medium text-red-600' : 'text-muted-foreground'}`}
                        >
                          {expired ? 'Expired ' : ''}
                          {fmtDate(m.expiryDate)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => {
                              setEditing(m)
                              setDialogOpen(true)
                            }}
                            title={`Edit ${m.name}`}
                            aria-label={`Edit ${m.name}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <MedicineDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        categories={categories}
        initial={editing}
        onSaved={() => void load()}
      />
    </div>
  )
}
