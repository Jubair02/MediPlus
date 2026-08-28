'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bike, Loader2, Pill, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { fmtDate } from '@/lib/format'
import type { AuthUser } from '@/lib/types'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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

interface StaffFormState {
  name: string
  email: string
  password: string
  phone: string
  role: 'PHARMACIST' | 'DELIVERY'
}

const EMPTY_STAFF_FORM: StaffFormState = {
  name: '',
  email: '',
  password: '',
  phone: '',
  role: 'PHARMACIST',
}

function StaffList({ people }: { people: AuthUser[] }) {
  if (people.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Nobody here yet.</p>
  }
  return (
    <ul className="max-h-96 space-y-2 overflow-y-auto scrollbar-thin">
      {people.map((p) => (
        <li
          key={p.id}
          className="flex items-center gap-3 rounded-lg border p-2.5 transition-colors hover:bg-accent/50"
        >
          <Avatar className="h-9 w-9">
            <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
              {(p.name ?? p.email).charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{p.name ?? 'Unnamed'}</p>
            <p className="truncate text-xs text-muted-foreground">{p.email}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">{p.phone ?? '—'}</p>
            <p className="text-[11px] text-muted-foreground/70">Joined {fmtDate(p.createdAt)}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

export default function AdminStaff() {
  const [pharmacists, setPharmacists] = useState<AuthUser[]>([])
  const [deliveryStaff, setDeliveryStaff] = useState<AuthUser[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<StaffFormState>(EMPTY_STAFF_FORM)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await api<{ pharmacists: AuthUser[]; deliveryStaff: AuthUser[] }>(
        '/api/admin?resource=staff'
      )
      setPharmacists(d.pharmacists)
      setDeliveryStaff(d.deliveryStaff)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load staff')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function createStaff() {
    if (!form.name.trim()) {
      setError('Name is required')
      return
    }
    if (!form.email.trim() || !form.email.includes('@')) {
      setError('A valid email is required')
      return
    }
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }
    setSaving(true)
    try {
      await api<{ user: AuthUser }>('/api/admin', {
        method: 'PUT',
        body: {
          action: 'create-staff',
          data: {
            name: form.name.trim(),
            email: form.email.trim(),
            password: form.password,
            phone: form.phone.trim() || undefined,
            role: form.role,
          },
        },
      })
      toast.success(`${form.role === 'PHARMACIST' ? 'Pharmacist' : 'Delivery staff'} account created`)
      setDialogOpen(false)
      setForm(EMPTY_STAFF_FORM)
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create staff account')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setDialogOpen(true)}>
          <UserPlus className="h-4 w-4" /> Add Staff
        </Button>
      </div>

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {[...Array(2)].map((_, i) => (
            <Skeleton key={i} className="h-64 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="gap-3 p-4">
            <CardHeader className="p-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                    <Pill className="h-4.5 w-4.5 text-primary" />
                  </div>
                  <CardTitle>Pharmacists</CardTitle>
                </div>
                <Badge variant="secondary">{pharmacists.length}</Badge>
              </div>
              <CardDescription>Review prescriptions and manage the catalog</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <StaffList people={pharmacists} />
            </CardContent>
          </Card>

          <Card className="gap-3 p-4">
            <CardHeader className="p-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100">
                    <Bike className="h-4.5 w-4.5 text-teal-700" />
                  </div>
                  <CardTitle>Delivery Staff</CardTitle>
                </div>
                <Badge variant="secondary">{deliveryStaff.length}</Badge>
              </div>
              <CardDescription>Assigned to outgoing orders</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <StaffList people={deliveryStaff} />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Add staff dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add staff account</DialogTitle>
            <DialogDescription>
              Create a pharmacist or delivery account. Share the credentials with the team member.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="staff-name">Name *</Label>
              <Input
                id="staff-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Full name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="staff-email">Email *</Label>
              <Input
                id="staff-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="name@medplus.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="staff-password">Password *</Label>
              <Input
                id="staff-password"
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="Min 6 characters"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="staff-phone">Phone</Label>
              <Input
                id="staff-phone"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="+880..."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="staff-role">Role</Label>
              <Select
                value={form.role}
                onValueChange={(v) => setForm((f) => ({ ...f, role: v as StaffFormState['role'] }))}
              >
                <SelectTrigger id="staff-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PHARMACIST">Pharmacist</SelectItem>
                  <SelectItem value="DELIVERY">Delivery</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void createStaff()} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Create account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
