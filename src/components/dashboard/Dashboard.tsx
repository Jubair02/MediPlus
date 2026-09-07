'use client'

import { useCallback, useState } from 'react'
import { useAppStore } from '@/lib/store'
import { ROLE_LABEL } from '@/lib/rbac'
import { Button } from '@/components/ui/button'
import DashboardSidebar from './DashboardSidebar'
import { canOpenSection, defaultSectionFor, sectionsFor } from './registry'
import AdminPanels from './panels/AdminPanels'
import PharmacistPanels from './panels/PharmacistPanels'
import DeliveryPanels from './panels/DeliveryPanels'

/** Contract every role's panel module implements. */
export interface PanelProps {
  sectionId: string
  /** Jump to another section — Overview's "view all orders" and friends. */
  goto: (id: string) => void
  /** Publish sidebar counts (pending reviews, open POs). Ignored by roles without any. */
  setBadges: (badges: Record<string, number>) => void
}

/**
 * The dashboard. One shell for every staff role.
 *
 * Roles do not get their own dashboard — they get the sections `registry.ts` admits for
 * them, rendered through this identical frame: same sidebar, same page heading, same
 * transition. Only the panel bodies differ, because only the work differs.
 */
export default function Dashboard() {
  const user = useAppStore((s) => s.user)
  const setAuthOpen = useAppStore((s) => s.setAuthOpen)
  const role = user?.role ?? null

  const sections = role ? sectionsFor(role) : []
  const [activeId, setActiveId] = useState<string>(() => (role ? (defaultSectionFor(role) ?? '') : ''))
  const [badges, setBadges] = useState<Record<string, number>>({})

  // A role change (sign out and back in as someone else) can leave an id this user may
  // not open. Fall back rather than render an empty frame.
  const safeId = role && canOpenSection(role, activeId) ? activeId : (role ? (defaultSectionFor(role) ?? '') : '')
  const section = sections.find((s) => s.id === safeId)

  const renderBadge = useCallback(
    (id: string) => {
      const n = badges[id] ?? 0
      if (n <= 0) return null
      return (
        <span className="ml-auto rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white">
          {n}
        </span>
      )
    },
    [badges]
  )

  if (!user || !role) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-muted-foreground">Please sign in to open your dashboard.</p>
        <Button onClick={() => setAuthOpen(true)}>Sign in</Button>
      </div>
    )
  }

  if (!section) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <p className="text-muted-foreground">You do not have permission to view this area.</p>
      </div>
    )
  }

  const panelProps: PanelProps = { sectionId: section.id, goto: setActiveId, setBadges }

  return (
    <div className="flex min-h-[calc(100dvh-var(--header-h))]">
      <DashboardSidebar
        title="Workspace"
        items={sections}
        activeId={section.id}
        onSelect={setActiveId}
        renderBadge={renderBadge}
        footer={
          <div className="rounded-lg bg-primary/10 p-3">
            <p className="text-[11px] text-muted-foreground">{ROLE_LABEL[role]}</p>
            <p className="truncate text-sm font-semibold text-primary">{user.name ?? user.email}</p>
            <p className="truncate text-[11px] text-muted-foreground">{user.email}</p>
          </div>
        }
      />

      <section className="min-w-0 flex-1 p-4 md:p-6">
        <header className="mb-4 md:mb-6">
          <h1 className="text-xl font-bold tracking-tight md:text-2xl">{section.title}</h1>
          <p className="text-sm text-muted-foreground">{section.subtitle}</p>
        </header>

        {/* Each module animates its own body — see PanelTransition for why the shell
            must not key this position. */}
        {role === 'ADMIN' && <AdminPanels {...panelProps} />}
        {role === 'PHARMACIST' && <PharmacistPanels {...panelProps} />}
        {role === 'DELIVERY' && <DeliveryPanels {...panelProps} />}
      </section>
    </div>
  )
}
