'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Loader2, Search, Users as UsersIcon } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { downloadCsv } from '@/lib/download'
import { useAppStore } from '@/lib/store'
import { fmtDate } from '@/lib/format'
import type { AuthUser, Role } from '@/lib/types'
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
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const ROLE_LABELS: Record<Role, string> = {
  CUSTOMER: 'Customer',
  PHARMACIST: 'Pharmacist',
  ADMIN: 'Admin',
  DELIVERY: 'Delivery',
}

const ROLES: Role[] = ['CUSTOMER', 'PHARMACIST', 'ADMIN', 'DELIVERY']

export default function AdminUsers() {
  const me = useAppStore((s) => s.user)
  const [users, setUsers] = useState<AuthUser[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('ALL')
  const [pendingRole, setPendingRole] = useState<{ user: AuthUser; role: Role } | null>(null)
  const [rowPending, setRowPending] = useState<string | null>(null)
  const [exportPending, setExportPending] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await api<{ users: AuthUser[] }>('/api/admin?resource=users')
      setUsers(d.users)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return users.filter((u) => {
      if (roleFilter !== 'ALL' && u.role !== roleFilter) return false
      if (!q) return true
      return `${u.name ?? ''} ${u.email} ${u.phone ?? ''}`.toLowerCase().includes(q)
    })
  }, [users, search, roleFilter])

  function isSelf(u: AuthUser): boolean {
    return u.id === me?.id || u.email === me?.email
  }

  async function exportCsv() {
    setExportPending(true)
    try {
      const d = await api<{ filename: string; csv: string }>('/api/admin?resource=export-users')
      if (typeof d.csv !== 'string' || typeof d.filename !== 'string')
        throw new Error('Export unavailable')
      downloadCsv(d.filename, d.csv)
      toast.success('Users exported')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to export users')
    } finally {
      setExportPending(false)
    }
  }

  async function applyRole(change: { user: AuthUser; role: Role }) {
    setRowPending(change.user.id)
    try {
      await api<{ user: AuthUser }>('/api/admin', {
        method: 'PUT',
        body: { action: 'update-user', id: change.user.id, role: change.role },
      })
      setUsers((prev) =>
        prev.map((u) => (u.id === change.user.id ? { ...u, role: change.role } : u))
      )
      toast.success(`${change.user.name ?? change.user.email} is now ${ROLE_LABELS[change.role]}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update role')
    } finally {
      setRowPending(null)
      setPendingRole(null)
    }
  }

  async function toggleStatus(u: AuthUser, next: boolean) {
    setRowPending(u.id)
    try {
      await api<{ user: AuthUser }>('/api/admin', {
        method: 'PUT',
        body: { action: 'update-user', id: u.id, status: next ? 'ACTIVE' : 'INACTIVE' },
      })
      setUsers((prev) =>
        prev.map((x) => (x.id === u.id ? { ...x, status: next ? 'ACTIVE' : 'INACTIVE' } : x))
      )
      toast.success(`${u.name ?? u.email} is now ${next ? 'ACTIVE' : 'INACTIVE'}`)
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
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-full sm:w-[170px]">
            <SelectValue placeholder="All roles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All roles</SelectItem>
            {ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email or phone"
            className="pl-8"
          />
        </div>
        <div className="sm:ml-auto">
          <Button variant="outline" onClick={() => void exportCsv()} disabled={exportPending}>
            {exportPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Export CSV
          </Button>
        </div>
      </div>

      {/* Table */}
      <Card className="gap-0 py-4">
        <CardContent className="px-4">
          <div className="overflow-x-auto scrollbar-thin">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-center">Active</TableHead>
                  <TableHead>Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  [...Array(5)].map((_, i) => (
                    <TableRow key={`sk-${i}`}>
                      <TableCell colSpan={6}>
                        <Skeleton className="h-9 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <div className="flex flex-col items-center gap-2 py-10 text-center">
                        <UsersIcon className="h-8 w-8 text-muted-foreground/50" />
                        <p className="text-sm text-muted-foreground">No users match your filters.</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((u) => {
                    const self = isSelf(u)
                    return (
                      <TableRow key={u.id} className="transition-colors hover:bg-accent/40">
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <Avatar className="h-8 w-8">
                              <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                                {(u.name ?? u.email).charAt(0).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="max-w-40 truncate text-sm font-medium">
                                {u.name ?? 'Unnamed'}
                                {self && (
                                  <Badge variant="outline" className="ml-2 border-primary/30 text-[10px] text-primary">
                                    You
                                  </Badge>
                                )}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-48 truncate text-sm text-muted-foreground">
                          {u.email}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {u.phone ?? '—'}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={u.role}
                            disabled={self || rowPending === u.id}
                            onValueChange={(v) =>
                              setPendingRole({ user: u, role: v as Role })
                            }
                          >
                            <SelectTrigger className="h-8 w-[140px] text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ROLES.map((r) => (
                                <SelectItem key={r} value={r}>
                                  {ROLE_LABELS[r]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-center">
                          <Switch
                            checked={u.status === 'ACTIVE'}
                            disabled={self || rowPending === u.id}
                            onCheckedChange={(v) => void toggleStatus(u, v)}
                            aria-label={`Toggle ${u.email}`}
                          />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {fmtDate(u.createdAt)}
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

      {/* Role change confirm */}
      <AlertDialog open={pendingRole !== null} onOpenChange={(o) => !o && setPendingRole(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change user role?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRole &&
                `${pendingRole.user.name ?? pendingRole.user.email} will become ${ROLE_LABELS[pendingRole.role]}. Access changes immediately.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={rowPending !== null}
              onClick={() => pendingRole && void applyRole(pendingRole)}
            >
              {(rowPending !== null) && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirm change
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
