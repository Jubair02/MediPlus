'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Address } from '@/lib/types'
import { Button } from '@/components/ui/button'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

interface AddressFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Pass an address to edit; omit/null to create a new one */
  initial?: Address | null
  /** Called with the saved address after a successful POST/PUT */
  onSaved: (address: Address) => void
}

const LABELS = ['Home', 'Office', 'Other'] as const

interface FormState {
  label: string
  recipient: string
  phone: string
  line1: string
  area: string
  city: string
  postcode: string
  isDefault: boolean
}

const emptyForm: FormState = {
  label: 'Home',
  recipient: '',
  phone: '',
  line1: '',
  area: '',
  city: 'Dhaka',
  postcode: '',
  isDefault: false,
}

/** Reusable add/edit address dialog (used by CheckoutView + ProfileView) */
export default function AddressFormDialog({ open, onOpenChange, initial, onSaved }: AddressFormDialogProps) {
  const [form, setForm] = useState<FormState>(emptyForm)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setError(null)
    setForm(
      initial?.id
        ? {
            label: initial.label ?? 'Home',
            recipient: initial.recipient ?? '',
            phone: initial.phone ?? '',
            line1: initial.line1 ?? '',
            area: initial.area ?? '',
            city: initial.city ?? '',
            postcode: initial.postcode ?? '',
            isDefault: initial.isDefault ?? false,
          }
        : { ...emptyForm }
    )
  }, [open, initial])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const submit = async () => {
    if (!form.recipient.trim() || !form.phone.trim() || !form.line1.trim() || !form.city.trim()) {
      setError('Recipient, phone, address line and city are required.')
      return
    }
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        label: form.label,
        recipient: form.recipient.trim(),
        phone: form.phone.trim(),
        line1: form.line1.trim(),
        area: form.area.trim() || undefined,
        city: form.city.trim(),
        postcode: form.postcode.trim() || undefined,
        isDefault: form.isDefault,
      }
      if (initial?.id) {
        const d = await api<{ address: Address }>('/api/addresses', {
          method: 'PUT',
          body: { id: initial.id, ...payload },
        })
        onSaved(d.address)
        toast.success('Address updated')
      } else {
        const d = await api<{ address: Address }>('/api/addresses', { method: 'POST', body: payload })
        onSaved(d.address)
        toast.success('Address added')
      }
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save address')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md scrollbar-thin">
        <DialogHeader>
          <DialogTitle>{initial?.id ? 'Edit address' : 'Add new address'}</DialogTitle>
          <DialogDescription>Where should we deliver your medicines?</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="addr-label">Label</Label>
            <Select value={form.label} onValueChange={(v) => set('label', v)}>
              <SelectTrigger id="addr-label" className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LABELS.map((l) => (
                  <SelectItem key={l} value={l}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="addr-recipient">Recipient *</Label>
            <Input
              id="addr-recipient"
              className="h-11"
              value={form.recipient}
              onChange={(e) => set('recipient', e.target.value)}
              placeholder="Full name"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="addr-phone">Phone *</Label>
            <Input
              id="addr-phone"
              type="tel"
              className="h-11"
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
              placeholder="01XXXXXXXXX"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="addr-line1">Address line *</Label>
            <Input
              id="addr-line1"
              className="h-11"
              value={form.line1}
              onChange={(e) => set('line1', e.target.value)}
              placeholder="House / road no."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="addr-area">Area</Label>
              <Input
                id="addr-area"
                className="h-11"
                value={form.area}
                onChange={(e) => set('area', e.target.value)}
                placeholder="e.g. Dhanmondi"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="addr-city">City *</Label>
              <Input
                id="addr-city"
                className="h-11"
                value={form.city}
                onChange={(e) => set('city', e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="addr-postcode">Postcode</Label>
            <Input
              id="addr-postcode"
              className="h-11"
              value={form.postcode}
              onChange={(e) => set('postcode', e.target.value)}
              placeholder="1200"
            />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div>
              <Label htmlFor="addr-default" className="text-sm font-medium">
                Set as default
              </Label>
              <p className="text-xs text-muted-foreground">Used automatically at checkout</p>
            </div>
            <Switch
              id="addr-default"
              checked={form.isDefault}
              onCheckedChange={(v) => set('isDefault', v === true)}
            />
          </div>

          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11 rounded-xl" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="h-11 rounded-xl" disabled={saving} onClick={() => void submit()}>
            {saving ? 'Saving…' : 'Save address'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
