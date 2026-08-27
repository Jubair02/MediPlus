'use client'

import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { formatDistanceToNow } from 'date-fns'
import {
  Bell,
  BellOff,
  CheckCheck,
  CheckCircle2,
  FileText,
  Loader2,
  LogIn,
  PackageCheck,
  RotateCcw,
  Truck,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import type { NotificationItem } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

interface NotificationsPayload {
  notifications: NotificationItem[]
  unread: number
}

type NotifTab = 'all' | 'unread'

/** Keyword-matched icon tile (title+message lowercase) */
function notifStyle(n: NotificationItem): { Icon: LucideIcon; iconCls: string; tileCls: string } {
  const text = `${n.title} ${n.message}`.toLowerCase()
  if (text.includes('confirm')) return { Icon: CheckCircle2, iconCls: 'text-emerald-600', tileCls: 'bg-emerald-500/10' }
  if (text.includes('out for delivery')) return { Icon: Truck, iconCls: 'text-teal-600', tileCls: 'bg-teal-500/10' }
  if (text.includes('deliver')) return { Icon: PackageCheck, iconCls: 'text-emerald-600', tileCls: 'bg-emerald-500/10' }
  if (text.includes('cancel')) return { Icon: XCircle, iconCls: 'text-red-500', tileCls: 'bg-red-500/10' }
  if (text.includes('prescription')) return { Icon: FileText, iconCls: 'text-amber-500', tileCls: 'bg-amber-500/10' }
  if (text.includes('refund')) return { Icon: RotateCcw, iconCls: 'text-teal-600', tileCls: 'bg-teal-500/10' }
  if (text.includes('assign')) return { Icon: Truck, iconCls: 'text-teal-600', tileCls: 'bg-teal-500/10' }
  return { Icon: Bell, iconCls: 'text-muted-foreground', tileCls: 'bg-muted' }
}

function timeAgo(dateStr: string): string {
  try {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true })
  } catch {
    return ''
  }
}

function NotificationRow({ n, index }: { n: NotificationItem; index: number }) {
  const { Icon, iconCls, tileCls } = notifStyle(n)
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.04, 0.3), ease: 'easeOut' }}
      className={cn(
        'flex items-start gap-3 rounded-xl border p-3',
        !n.read && 'border-emerald-200/70 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20'
      )}
    >
      <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-full', tileCls)}>
        <Icon className={cn('size-5', iconCls)} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{n.title}</p>
          {!n.read && (
            <span className="shrink-0 rounded-full bg-emerald-600 px-1.5 py-px text-[10px] font-bold leading-4 text-white">
              New
            </span>
          )}
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">{n.message}</p>
      </div>
      <time
        dateTime={n.createdAt}
        className="shrink-0 whitespace-nowrap pt-0.5 text-[11px] text-muted-foreground/80"
      >
        {timeAgo(n.createdAt)}
      </time>
    </motion.div>
  )
}

export default function NotificationsView() {
  const user = useAppStore((s) => s.user)
  const setAuthOpen = useAppStore((s) => s.setAuthOpen)

  const [notifications, setNotifications] = useState<NotificationItem[] | null>(null)
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [tab, setTab] = useState<NotifTab>('all')
  const [marking, setMarking] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const d = await api<NotificationsPayload>('/api/notifications', { signal })
      setNotifications(d.notifications)
      setUnread(d.unread)
      setFailed(false)
    } catch (err) {
      if (signal?.aborted) return
      setFailed(err instanceof Error)
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!user) return
    const ac = new AbortController()
    void load(ac.signal)
    return () => ac.abort()
  }, [user, load, reloadKey])

  // ---------- guard ----------
  if (!user) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-primary/10">
          <LogIn className="size-8 text-primary" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-xl font-bold">Sign in to see notifications</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Order updates, prescription reviews and delivery alerts in one place.
        </p>
        <Button className="mt-6 h-11 rounded-xl" onClick={() => setAuthOpen(true)}>
          <LogIn className="size-4" aria-hidden="true" />
          Sign in
        </Button>
      </div>
    )
  }

  const markAllRead = async () => {
    setMarking(true)
    try {
      await api<{ ok: boolean }>('/api/notifications', { method: 'PUT', body: { action: 'read-all' } })
      await load()
      // Let the header bell badge drop to zero without reopening its popover
      window.dispatchEvent(new CustomEvent('medplus:notifications-read'))
      toast.success('All notifications marked as read')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to mark notifications as read')
    } finally {
      setMarking(false)
    }
  }

  const visible =
    notifications === null ? null : tab === 'unread' ? notifications.filter((n) => !n.read) : notifications

  return (
    <div className="mx-auto max-w-4xl px-4 pb-16 pt-6 lg:px-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Notifications</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Order updates, prescription reviews and delivery alerts.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5 rounded-lg"
          disabled={unread === 0 || marking || loading}
          onClick={() => void markAllRead()}
        >
          {marking ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <CheckCheck className="size-4" aria-hidden="true" />
          )}
          Mark all read
        </Button>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as NotifTab)} className="mt-5">
        <TabsList>
          <TabsTrigger value="all" className="min-w-20 px-4">
            All
          </TabsTrigger>
          <TabsTrigger value="unread" className="min-w-20 gap-1.5 px-4">
            Unread
            {unread > 0 && (
              <span className="inline-flex size-5 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* List */}
      <div className="mx-auto mt-4 max-w-2xl space-y-2">
        {loading && notifications === null ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)
        ) : failed ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center">
            <p className="text-sm text-muted-foreground">Couldn&apos;t load notifications.</p>
            <Button
              variant="outline"
              size="sm"
              className="h-9 rounded-lg"
              onClick={() => setReloadKey((k) => k + 1)}
            >
              Try again
            </Button>
          </div>
        ) : visible && visible.length > 0 ? (
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="space-y-2"
            >
              {visible.map((n, i) => (
                <NotificationRow key={n.id} n={n} index={i} />
              ))}
            </motion.div>
          </AnimatePresence>
        ) : (
          <Card className="flex-col items-center gap-2 border-dashed p-10 text-center shadow-sm">
            <span className="flex size-14 items-center justify-center rounded-full bg-muted">
              <BellOff className="size-7 text-muted-foreground" aria-hidden="true" />
            </span>
            {tab === 'unread' ? (
              <>
                <p className="font-semibold">You&apos;re all caught up</p>
                <p className="max-w-xs text-sm text-muted-foreground">
                  No unread notifications right now.
                </p>
              </>
            ) : (
              <>
                <p className="font-semibold">No notifications yet</p>
                <p className="max-w-xs text-sm text-muted-foreground">
                  Order updates and prescription reviews will appear here.
                </p>
              </>
            )}
          </Card>
        )}
      </div>
    </div>
  )
}
