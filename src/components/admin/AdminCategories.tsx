'use client'

import { useCallback, useEffect, useState } from 'react'
import { FolderTree, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Category } from '@/lib/types'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'

interface CatFormState {
  name: string
  description: string
}

export default function AdminCategories() {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Category | null>(null)
  const [form, setForm] = useState<CatFormState>({ name: '', description: '' })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deletePending, setDeletePending] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await api<{ categories: Category[] }>('/api/admin?resource=categories')
      setCategories(d.categories)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load categories')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function openAdd() {
    setEditing(null)
    setForm({ name: '', description: '' })
    setError(null)
    setDialogOpen(true)
  }

  function openEdit(c: Category) {
    setEditing(c)
    setForm({ name: c.name, description: c.description ?? '' })
    setError(null)
    setDialogOpen(true)
  }

  async function save() {
    if (!form.name.trim()) {
      setError('Category name is required')
      return
    }
    setSaving(true)
    try {
      const data = { name: form.name.trim(), description: form.description.trim() || null }
      if (editing) {
        await api<{ category: Category }>('/api/admin', {
          method: 'PUT',
          body: { action: 'update-category', id: editing.id, data },
        })
        toast.success('Category updated')
      } else {
        await api<{ category: Category }>('/api/admin', {
          method: 'PUT',
          body: { action: 'create-category', data },
        })
        toast.success('Category created')
      }
      setDialogOpen(false)
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save category')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!deleteId) return
    setDeletePending(true)
    try {
      await api('/api/admin', { method: 'PUT', body: { action: 'delete-category', id: deleteId } })
      toast.success('Category deleted')
      setDeleteId(null)
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete category')
    } finally {
      setDeletePending(false)
    }
  }

  const deleteTarget = categories.find((c) => c.id === deleteId) ?? null

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openAdd}>
          <Plus className="h-4 w-4" /> Add Category
        </Button>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      ) : categories.length === 0 ? (
        <Card className="items-center p-10 text-center">
          <FolderTree className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            No categories yet — create the first one.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((c) => (
            <Card key={c.id} className="gap-3 p-4 transition-shadow hover:shadow-md">
              <CardHeader className="p-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                    <FolderTree className="h-4.5 w-4.5 text-primary" />
                  </div>
                  <Badge variant="secondary">{c.medicineCount ?? 0} medicines</Badge>
                </div>
                <CardTitle className="pt-1">{c.name}</CardTitle>
                <CardDescription className="line-clamp-2 min-h-4">
                  {c.description || 'No description'}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex gap-2 p-0">
                <Button variant="outline" size="sm" onClick={() => openEdit(c)}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-600 hover:bg-red-50 hover:text-red-700"
                  onClick={() => setDeleteId(c.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit category' : 'Add category'}</DialogTitle>
            <DialogDescription>
              Categories group medicines into departments for the storefront.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cat-name">Name *</Label>
              <Input
                id="cat-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Pain Relief"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cat-desc">Description</Label>
              <Textarea
                id="cat-desc"
                rows={3}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? 'Save changes' : 'Create category'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete category?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `"${deleteTarget.name}" will be removed. Medicines in it become uncategorized.`
                : 'Medicines in this category become uncategorized.'}
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

