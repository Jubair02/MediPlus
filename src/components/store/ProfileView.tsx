'use client'

import { useEffect, useState } from 'react'
import { LogIn, MapPin, Pencil, Plus, Star, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import type { Address } from '@/lib/types'
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
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import AddressFormDialog from '@/components/store/AddressFormDialog'

export default function ProfileView() {
  const user = useAppStore((s) => s.user)
  const setUser = useAppStore((s) => s.setUser)
  const setAuthOpen = useAppStore((s) => s.setAuthOpen)

  // Profile form
  const [name, setName] = useState(user?.name ?? '')
  const [phone, setPhone] = useState(user?.phone ?? '')
  const [savingProfile, setSavingProfile] = useState(false)

  // Password form
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)

  // Addresses
  const [addresses, setAddresses] = useState<Address[] | null>(null)
  const [addressDialogOpen, setAddressDialogOpen] = useState(false)
  const [editingAddress, setEditingAddress] = useState<Address | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Address | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!user) return
    const ac = new AbortController()
    api<{ addresses: Address[] }>('/api/addresses', { signal: ac.signal })
      .then((d) => setAddresses(d.addresses))
      .catch(() => {})
    return () => ac.abort()
  }, [user])

  // ---------- guard ----------
  if (!user) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-primary/10">
          <LogIn className="size-8 text-primary" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-xl font-bold">Sign in to view your profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your details, password and saved addresses.
        </p>
        <Button className="mt-6 h-11 rounded-xl" onClick={() => setAuthOpen(true)}>
          <LogIn className="size-4" aria-hidden="true" />
          Sign in
        </Button>
      </div>
    )
  }

  const saveProfile = async () => {
    if (!name.trim()) {
      toast.error('Name cannot be empty')
      return
    }
    setSavingProfile(true)
    try {
      const d = await api<{ user: typeof user }>('/api/auth', {
        method: 'PUT',
        body: { name: name.trim(), phone: phone.trim() || undefined },
      })
      if (d.user) setUser(d.user)
      toast.success('Profile updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update profile')
    } finally {
      setSavingProfile(false)
    }
  }

  const savePassword = async () => {
    if (!currentPassword || !newPassword) {
      toast.error('Please fill in both password fields')
      return
    }
    if (newPassword.length < 8) {
      toast.error('New password must be at least 8 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match')
      return
    }
    setSavingPassword(true)
    try {
      await api<{ user: typeof user }>('/api/auth', {
        method: 'PUT',
        body: { currentPassword, newPassword },
      })
      toast.success('Password changed')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to change password')
    } finally {
      setSavingPassword(false)
    }
  }

  const addressSaved = (a: Address) => {
    setAddresses((prev) => {
      const exists = prev?.some((p) => p.id === a.id)
      const next = exists ? (prev ?? []).map((p) => (p.id === a.id ? a : p)) : [...(prev ?? []), a]
      return a.isDefault ? next.map((p) => ({ ...p, isDefault: p.id === a.id })) : next
    })
  }

  const setDefault = async (a: Address) => {
    if (!a.id) return
    try {
      const d = await api<{ address: Address }>('/api/addresses', {
        method: 'PUT',
        body: { id: a.id, isDefault: true },
      })
      setAddresses((prev) =>
        (prev ?? []).map((p) => ({ ...p, isDefault: p.id === d.address.id }))
      )
      toast.success('Default address updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to set default address')
    }
  }

  const deleteAddress = async () => {
    if (!deleteTarget?.id) return
    setDeleting(true)
    try {
      await api<{ ok: boolean }>(
        `/api/addresses?id=${encodeURIComponent(deleteTarget.id)}`,
        { method: 'DELETE' }
      )
      setAddresses((prev) => (prev ?? []).filter((p) => p.id !== deleteTarget.id))
      toast.success('Address deleted')
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete address')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 pt-6 lg:px-6">
      <h1 className="text-xl font-bold tracking-tight sm:text-2xl">My profile</h1>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
        {/* ---------- 1. Profile ---------- */}
        <Card className="gap-4 p-5 shadow-sm">
          <div className="flex items-center gap-4">
            <Avatar className="size-14 border">
              <AvatarFallback className="bg-primary/10 text-xl font-bold text-primary">
                {(user.name?.[0] ?? user.email[0] ?? 'U').toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate font-semibold">{user.name ?? 'Unnamed user'}</p>
              <p className="truncate text-sm text-muted-foreground">{user.email}</p>
              <Badge variant="secondary" className="mt-1 rounded-md">
                {user.role}
              </Badge>
            </div>
          </div>

          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="profile-name">Full name</Label>
              <Input
                id="profile-name"
                className="h-11"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="profile-phone">Phone</Label>
              <Input
                id="profile-phone"
                type="tel"
                className="h-11"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="01XXXXXXXXX"
              />
            </div>
            <Button
              className="h-11 rounded-xl"
              disabled={savingProfile}
              onClick={() => void saveProfile()}
            >
              {savingProfile ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </Card>

        {/* ---------- 2. Change password ---------- */}
        <Card className="gap-4 p-5 shadow-sm">
          <h2 className="font-semibold">Change password</h2>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="pw-current">Current password</Label>
              <Input
                id="pw-current"
                type="password"
                autoComplete="current-password"
                className="h-11"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pw-new">New password</Label>
              <Input
                id="pw-new"
                type="password"
                autoComplete="new-password"
                className="h-11"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pw-confirm">Confirm new password</Label>
              <Input
                id="pw-confirm"
                type="password"
                autoComplete="new-password"
                className="h-11"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            {confirmPassword && newPassword !== confirmPassword && (
              <p className="text-sm font-medium text-red-600">Passwords do not match</p>
            )}
            <Button
              className="h-11 rounded-xl"
              disabled={savingPassword}
              onClick={() => void savePassword()}
            >
              {savingPassword ? 'Updating…' : 'Update password'}
            </Button>
          </div>
        </Card>

        {/* ---------- 3. My addresses ---------- */}
        <Card className="gap-4 p-5 shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-semibold">
              <MapPin className="size-4 text-primary" aria-hidden="true" />
              My addresses
            </h2>
            <Button
              size="sm"
              className="h-9 gap-1.5 rounded-lg"
              onClick={() => {
                setEditingAddress(null)
                setAddressDialogOpen(true)
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              Add address
            </Button>
          </div>

          {addresses === null ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-40 rounded-xl" />
              ))}
            </div>
          ) : addresses.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No saved addresses yet. Add one to speed up checkout.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {addresses.map((a) => (
                <div
                  key={a.id}
                  className="rounded-xl border p-4 text-sm shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="rounded-md">
                      {a.label}
                    </Badge>
                    {a.isDefault && (
                      <Badge className="gap-1 rounded-md bg-emerald-100 text-emerald-700">
                        <Star className="size-3" aria-hidden="true" />
                        Default
                      </Badge>
                    )}
                    <div className="ml-auto flex gap-1">
                      {!a.isDefault && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 rounded-md px-2 text-xs"
                          onClick={() => void setDefault(a)}
                        >
                          Set default
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 rounded-md"
                        aria-label={`Edit ${a.label} address`}
                        onClick={() => {
                          setEditingAddress(a)
                          setAddressDialogOpen(true)
                        }}
                      >
                        <Pencil className="size-3.5" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 rounded-md text-red-600 hover:bg-red-50 hover:text-red-600"
                        aria-label={`Delete ${a.label} address`}
                        onClick={() => setDeleteTarget(a)}
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                  <p className="mt-2 font-semibold">{a.recipient}</p>
                  <p className="text-muted-foreground">{a.phone}</p>
                  <p className="mt-1 leading-snug">
                    {a.line1}
                    {a.area ? `, ${a.area}` : ''}, {a.city}
                    {a.postcode ? ` ${a.postcode}` : ''}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Add / edit address dialog */}
      <AddressFormDialog
        open={addressDialogOpen}
        onOpenChange={setAddressDialogOpen}
        initial={editingAddress}
        onSaved={addressSaved}
      />

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this address?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.recipient} — {deleteTarget?.line1}, {deleteTarget?.city}. This cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 rounded-xl">Keep address</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 rounded-xl bg-red-600 text-white hover:bg-red-700"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault()
                void deleteAddress()
              }}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
