'use client'

import { useEffect, useRef } from 'react'
import type { LucideIcon } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

export interface SidebarItem<T extends string> {
  id: T
  label: string
  icon: LucideIcon
}

interface Props<T extends string> {
  /** Small label above the nav, e.g. "Admin panel". */
  title: string
  items: readonly SidebarItem<T>[]
  activeId: T
  onSelect: (id: T) => void
  /** Rendered at the bottom when expanded — the signed-in identity card. */
  footer?: React.ReactNode
  /**
   * Optional per-item count (pending reviews, open POs). Returns null when there is
   * nothing to report. In the collapsed rail there is no room for the number, so it
   * degrades to a dot — the item still reads as "needs attention".
   */
  renderBadge?: (id: T) => React.ReactNode
}

/**
 * Dashboard navigation, shared by the admin and pharmacist panels.
 *
 * Two presentations from one source of truth:
 *  - md and up: a rail that collapses from labels to icons. Width is the only animated
 *    property, and the labels are removed from the tree when collapsed so they cannot be
 *    reached by tab or read aloud.
 *  - below md: an off-canvas drawer over a scrim, animated with transform so it stays on
 *    the compositor.
 *
 * Collapse state lives in the store because the toggle sits in the header, not here.
 */
export default function DashboardSidebar<T extends string>({
  title,
  items,
  activeId,
  onSelect,
  footer,
  renderBadge,
}: Props<T>) {
  const collapsed = useAppStore((s) => s.sidebarCollapsed)
  const open = useAppStore((s) => s.sidebarOpen)
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen)
  const panelRef = useRef<HTMLDivElement>(null)

  // Escape closes the drawer. Only bound while it is open, so it cannot swallow Escape
  // from a dialog opened on top of the dashboard.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setSidebarOpen])

  // Move focus into the drawer when it opens so keyboard users are not left behind on
  // the toggle button.
  useEffect(() => {
    if (open) panelRef.current?.focus()
  }, [open])

  const nav = (isRail: boolean) => (
    <nav className="flex flex-col gap-1" aria-label={title}>
      {items.map((item) => {
        const active = item.id === activeId
        const badge = renderBadge?.(item.id)
        const button = (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group relative flex min-h-11 items-center rounded-lg text-sm text-muted-foreground outline-none transition-colors',
              'hover:bg-accent hover:text-accent-foreground',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
              active && 'bg-primary/10 font-medium text-primary',
              isRail ? 'justify-center px-0' : 'gap-2.5 px-3'
            )}
          >
            {/* Active marker: reads at a glance even in the rail, where the label is gone. */}
            <span
              aria-hidden="true"
              className={cn(
                'absolute left-0 h-5 w-0.5 rounded-r-full bg-primary transition-opacity',
                active ? 'opacity-100' : 'opacity-0'
              )}
            />
            <item.icon className="size-4 shrink-0" aria-hidden="true" />
            {!isRail && <span className="truncate">{item.label}</span>}
            {isRail && <span className="sr-only">{item.label}</span>}
            {badge &&
              (isRail ? (
                <span
                  aria-hidden="true"
                  className="absolute right-2 top-2 size-2 rounded-full bg-amber-500 ring-2 ring-card"
                />
              ) : (
                badge
              ))}
          </button>
        )
        // A rail button shows only an icon, so the label has to surface on hover.
        return isRail ? (
          <Tooltip key={item.id}>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent side="right" className="flex items-center gap-2">
              {item.label}
              {badge}
            </TooltipContent>
          </Tooltip>
        ) : (
          button
        )
      })}
    </nav>
  )

  return (
    <TooltipProvider delayDuration={200}>
      {/* ---------- desktop rail ---------- */}
      <aside
        id="dashboard-sidebar"
        className={cn(
          'sticky top-[var(--header-h)] hidden h-[calc(100dvh-var(--header-h))] shrink-0 flex-col',
          'border-r bg-card md:flex',
          'transition-[width] duration-200 ease-out motion-reduce:transition-none',
          collapsed ? 'w-[4.25rem] px-2 py-3' : 'w-60 p-3'
        )}
      >
        {!collapsed && (
          <p className="px-2 pb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </p>
        )}
        {nav(collapsed)}
        {!collapsed && footer && <div className="mt-auto pt-3">{footer}</div>}
      </aside>

      {/* ---------- mobile drawer ---------- */}
      <div
        className={cn('md:hidden', open ? 'pointer-events-auto' : 'pointer-events-none')}
        aria-hidden={!open}
      >
        {/* Scrim */}
        <button
          type="button"
          tabIndex={open ? 0 : -1}
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
          className={cn(
            'fixed inset-0 z-40 bg-foreground/40 backdrop-blur-[2px] transition-opacity duration-200 motion-reduce:transition-none',
            open ? 'opacity-100' : 'opacity-0'
          )}
        />
        <div
          ref={panelRef}
          tabIndex={-1}
          role="dialog"
          aria-modal={open || undefined}
          aria-label={title}
          className={cn(
            'fixed inset-y-0 left-0 z-50 flex w-[17rem] max-w-[85vw] flex-col gap-3 border-r bg-card p-3 shadow-xl outline-none',
            'transition-transform duration-200 ease-out motion-reduce:transition-none',
            open ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          <p className="px-2 pt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </p>
          {nav(false)}
          {footer && <div className="mt-auto">{footer}</div>}
        </div>
      </div>
    </TooltipProvider>
  )
}
