'use client'

import { useState } from 'react'
import { Eye, EyeOff, LogIn, Pill, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import type { AuthUser, Role } from '@/lib/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

const DEMO_ACCOUNTS: { role: Role; email: string; password: string }[] = [
  { role: 'CUSTOMER', email: 'customer@medplus.com', password: 'Customer123!' },
  { role: 'PHARMACIST', email: 'pharmacist@medplus.com', password: 'Pharma123!' },
  { role: 'DELIVERY', email: 'delivery@medplus.com', password: 'Deliver123!' },
  { role: 'ADMIN', email: 'admin@medplus.com', password: 'Admin123!' },
]

export default function AuthModal() {
  const authOpen = useAppStore((s) => s.authOpen)
  const setAuthOpen = useAppStore((s) => s.setAuthOpen)
  const login = useAppStore((s) => s.login)

  const [tab, setTab] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [showPw, setShowPw] = useState(false)

  const [regName, setRegName] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regPhone, setRegPhone] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [regConfirm, setRegConfirm] = useState('')

  const [busy, setBusy] = useState(false)

  // Redirect to the role's dashboard is handled by login() in the store.
  const afterAuth = (user: AuthUser) => {
    toast.success(tab === 'login' ? `Welcome back, ${user.name ?? user.email}` : `Welcome, ${user.name ?? user.email}`)
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !loginPassword) {
      toast.error('Please enter your email and password')
      return
    }
    setBusy(true)
    try {
      const d = await api<{ token: string; user: AuthUser }>('/api/auth', {
        method: 'POST',
        body: { action: 'login', email: email.trim(), password: loginPassword },
      })
      login(d.token, d.user)
      afterAuth(d.user)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setBusy(false)
    }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!regName.trim()) {
      toast.error('Please enter your name')
      return
    }
    if (!/^\S+@\S+\.\S+$/.test(regEmail.trim())) {
      toast.error('Please enter a valid email address')
      return
    }
    if (regPassword.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    if (regPassword !== regConfirm) {
      toast.error('Passwords do not match')
      return
    }
    setBusy(true)
    try {
      const d = await api<{ token: string; user: AuthUser }>('/api/auth', {
        method: 'POST',
        body: {
          action: 'register',
          name: regName.trim(),
          email: regEmail.trim(),
          phone: regPhone.trim() || undefined,
          password: regPassword,
        },
      })
      login(d.token, d.user)
      afterAuth(d.user)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setBusy(false)
    }
  }

  const fillDemo = (acc: (typeof DEMO_ACCOUNTS)[number]) => {
    setTab('login')
    setEmail(acc.email)
    setLoginPassword(acc.password)
  }

  const passwordInput = (
    id: string,
    value: string,
    onChange: (v: string) => void,
    autoComplete: string,
    placeholder?: string
  ) => (
    <div className="relative">
      <Input
        id={id}
        type={showPw ? 'text' : 'password'}
        autoComplete={autoComplete}
        className="h-11 pr-11"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
      />
      <button
        type="button"
        onClick={() => setShowPw((s) => !s)}
        aria-label={showPw ? 'Hide password' : 'Show password'}
        className="absolute right-1 top-1 flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {showPw ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
      </button>
    </div>
  )

  return (
    <Dialog open={authOpen} onOpenChange={setAuthOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md scrollbar-thin">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary">
              <Pill className="size-5 text-primary-foreground" aria-hidden="true" />
            </span>
            Welcome to MediPlus
          </DialogTitle>
          <DialogDescription>
            Sign in to order medicines, upload prescriptions and track deliveries.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v === 'register' ? 'register' : 'login')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login">Sign in</TabsTrigger>
            <TabsTrigger value="register">Create account</TabsTrigger>
          </TabsList>

          {/* ---------- Sign in ---------- */}
          <TabsContent value="login">
            <form onSubmit={handleLogin} className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="login-email">Email</Label>
                <Input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  className="h-11"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="login-password">Password</Label>
                {passwordInput('login-password', loginPassword, setLoginPassword, 'current-password')}
              </div>
              <Button type="submit" className="mt-1 h-11 rounded-xl" disabled={busy}>
                <LogIn className="size-4" aria-hidden="true" />
                {busy ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          </TabsContent>

          {/* ---------- Register ---------- */}
          <TabsContent value="register">
            <form onSubmit={handleRegister} className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="reg-name">Full name</Label>
                <Input
                  id="reg-name"
                  autoComplete="name"
                  className="h-11"
                  placeholder="Your name"
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                  required
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="reg-email">Email</Label>
                <Input
                  id="reg-email"
                  type="email"
                  autoComplete="email"
                  className="h-11"
                  placeholder="you@example.com"
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  required
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="reg-phone">Phone (optional)</Label>
                <Input
                  id="reg-phone"
                  type="tel"
                  autoComplete="tel"
                  className="h-11"
                  placeholder="01XXXXXXXXX"
                  value={regPhone}
                  onChange={(e) => setRegPhone(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="reg-password">Password</Label>
                {passwordInput('reg-password', regPassword, setRegPassword, 'new-password', 'At least 8 characters')}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="reg-confirm">Confirm password</Label>
                {passwordInput('reg-confirm', regConfirm, setRegConfirm, 'new-password')}
              </div>
              {regConfirm && regPassword !== regConfirm && (
                <p className="text-sm font-medium text-red-600">Passwords do not match</p>
              )}
              <Button type="submit" className="mt-1 h-11 rounded-xl" disabled={busy}>
                <UserPlus className="size-4" aria-hidden="true" />
                {busy ? 'Creating account…' : 'Create account'}
              </Button>
            </form>
          </TabsContent>
        </Tabs>

        {/* ---------- Demo accounts ---------- */}
        <div className="rounded-xl border bg-muted/40 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Demo accounts — click to fill
          </p>
          <div className="grid gap-1">
            {DEMO_ACCOUNTS.map((acc) => (
              <button
                key={acc.email}
                type="button"
                onClick={() => fillDemo(acc)}
                className={cn(
                  'flex min-h-11 items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-left text-xs transition-colors',
                  'hover:bg-accent'
                )}
              >
                <span className="font-semibold">{acc.role}</span>
                <span className="truncate text-muted-foreground">{acc.email}</span>
                <span className="hidden font-mono text-muted-foreground sm:inline">{acc.password}</span>
              </button>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
