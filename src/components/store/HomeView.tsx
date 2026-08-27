'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  BadgeCheck,
  Clock,
  FileCheck,
  FileText,
  ShieldCheck,
  Truck,
  UploadCloud,
} from 'lucide-react'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { fmtBDT } from '@/lib/format'
import type { Category, Medicine } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import MedicineCard, { MedImage } from '@/components/store/MedicineCard'

const FREE_DELIVERY_THRESHOLD = 2000

const features = [
  { icon: Truck, title: 'Free delivery', desc: `On orders over ${fmtBDT(FREE_DELIVERY_THRESHOLD)}` },
  { icon: ShieldCheck, title: 'Verified sources', desc: '100% genuine medicines' },
  { icon: FileCheck, title: 'Pharmacist checks', desc: 'Every Rx verified by experts' },
  { icon: Clock, title: 'Order tracking', desc: 'Follow your parcel live' },
]

const rxSteps = [
  { icon: UploadCloud, title: 'Upload', desc: 'Snap a photo of your prescription' },
  { icon: FileCheck, title: 'Pharmacist review', desc: 'A licensed pharmacist verifies it' },
  { icon: BadgeCheck, title: 'Confirmed & delivered', desc: 'Order processed and shipped' },
]

export default function HomeView() {
  const user = useAppStore((s) => s.user)
  const setView = useAppStore((s) => s.setView)
  const setFilters = useAppStore((s) => s.setFilters)
  const resetFilters = useAppStore((s) => s.resetFilters)
  const setAuthOpen = useAppStore((s) => s.setAuthOpen)
  const setDetailMedicine = useAppStore((s) => s.setDetailMedicine)

  const [categories, setCategories] = useState<Category[] | null>(null)
  const [deals, setDeals] = useState<Medicine[] | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    api<{ categories: Category[] }>('/api/categories', { signal: ac.signal })
      .then((d) => setCategories(d.categories))
      .catch(() => {})
    api<{ medicines: Medicine[] }>('/api/medicines?featured=true&limit=8', { signal: ac.signal })
      .then((d) => setDeals(d.medicines.slice(0, 8)))
      .catch(() => {})
    return () => ac.abort()
  }, [])

  const shopCategory = (c: Category) => {
    setFilters({ category: c.id, page: 1 })
    setView('catalog')
  }

  const viewAllDeals = () => {
    resetFilters()
    setView('catalog')
  }

  const openPrescriptions = () => {
    if (user) setView('prescriptions')
    else setAuthOpen(true)
  }

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 pt-6 lg:px-6">
      {/* ---------- Hero ---------- */}
      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="med-gradient relative overflow-hidden rounded-2xl"
      >
        <div
          className="absolute -right-16 -top-16 size-56 rounded-full bg-emerald-400/20 blur-2xl"
          aria-hidden="true"
        />
        <div
          className="absolute -bottom-20 -left-10 size-64 rounded-full bg-teal-400/20 blur-2xl"
          aria-hidden="true"
        />
        <div className="relative grid items-center gap-8 p-6 sm:p-10 lg:grid-cols-2 lg:p-14">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-1 text-xs font-semibold text-emerald-700 shadow-sm">
              <ShieldCheck className="size-3.5" aria-hidden="true" />
              Trusted by thousands of families
            </span>
            <h1 className="mt-4 text-3xl font-extrabold leading-tight tracking-tight text-emerald-950 text-balance sm:text-4xl lg:text-5xl">
              Genuine medicines, delivered to your door
            </h1>
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-emerald-900/80 sm:text-base">
              Order over-the-counter essentials and prescription medicines from licensed
              pharmacists — with same-day delivery across Dhaka.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button size="lg" className="h-11 rounded-xl shadow-sm" onClick={() => setView('catalog')}>
                Shop medicines
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-11 rounded-xl border-emerald-700/30 bg-white/60 hover:bg-white"
                onClick={openPrescriptions}
              >
                <UploadCloud className="size-4" aria-hidden="true" />
                Upload prescription
              </Button>
            </div>
            <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2">
              {[
                { icon: ShieldCheck, label: '100% Genuine' },
                { icon: Truck, label: 'Same-day delivery' },
                { icon: BadgeCheck, label: 'Licensed pharmacists' },
              ].map((t) => (
                <span
                  key={t.label}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-900/90"
                >
                  <t.icon className="size-4 text-emerald-700" aria-hidden="true" />
                  {t.label}
                </span>
              ))}
            </div>
          </div>
          <div className="relative">
            <MedImage
              src="/images/hero.png"
              alt="Pharmacy delivery"
              className="aspect-[4/3] w-full rounded-2xl bg-white/40 shadow-lg shadow-emerald-900/10"
            />
          </div>
        </div>
      </motion.section>

      {/* ---------- Feature strip ---------- */}
      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.05 }}
        className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4"
      >
        {features.map((f) => (
          <Card key={f.title} className="flex-row items-center gap-3 p-4 shadow-sm">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <f.icon className="size-5 text-primary" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-tight">{f.title}</p>
              <p className="truncate text-xs text-muted-foreground">{f.desc}</p>
            </div>
          </Card>
        ))}
      </motion.section>

      {/* ---------- Categories ---------- */}
      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.1 }}
        className="mt-12"
      >
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight sm:text-2xl">Shop by category</h2>
            <p className="text-sm text-muted-foreground">Everything your family needs</p>
          </div>
        </div>
        {!categories ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[5/4] rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:gap-4">
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => shopCategory(c)}
                className="group overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <MedImage
                  src={c.image ?? `/images/cat-${c.slug}.png`}
                  alt={c.name}
                  className="aspect-[5/3] w-full transition-transform duration-300 group-hover:scale-[1.03]"
                />
                <div className="p-3">
                  <p className="line-clamp-1 text-sm font-semibold">{c.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.medicineCount ?? 0} medicines
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </motion.section>

      {/* ---------- Deals ---------- */}
      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.15 }}
        className="mt-12"
      >
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight sm:text-2xl">Deals of the week</h2>
            <p className="text-sm text-muted-foreground">Save big on featured medicines</p>
          </div>
          <Button variant="link" className="h-11 px-2" onClick={viewAllDeals}>
            View all
          </Button>
        </div>
        {!deals ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="aspect-square rounded-xl" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ))}
          </div>
        ) : deals.length === 0 ? (
          <Card className="items-center p-8 text-center">
            <p className="text-sm text-muted-foreground">No featured medicines right now — check back soon.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-4">
            {deals.map((m) => (
              <MedicineCard key={m.id} medicine={m} onView={setDetailMedicine} />
            ))}
          </div>
        )}
      </motion.section>

      {/* ---------- Prescription banner ---------- */}
      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.2 }}
        className="mt-12 overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 via-emerald-600 to-teal-700 p-6 text-white shadow-md sm:p-10"
      >
        <div className="grid items-center gap-8 lg:grid-cols-[1fr_auto]">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
              <FileText className="size-3.5" aria-hidden="true" />
              Prescription medicines
            </span>
            <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
              Need prescription medicines?
            </h2>
            <p className="mt-2 max-w-xl text-sm text-emerald-50/90">
              Upload a photo of your prescription — a licensed pharmacist reviews it and your
              medicines arrive at your door.
            </p>
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              {rxSteps.map((s, i) => (
                <div key={s.title} className="flex items-start gap-3">
                  <span className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-white/15">
                    <s.icon className="size-5" aria-hidden="true" />
                    <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-white text-[11px] font-bold text-emerald-700">
                      {i + 1}
                    </span>
                  </span>
                  <div>
                    <p className="text-sm font-semibold">{s.title}</p>
                    <p className="text-xs text-emerald-50/80">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <Button
            size="lg"
            className="h-12 rounded-xl bg-white px-6 font-semibold text-emerald-700 shadow-md hover:bg-emerald-50"
            onClick={openPrescriptions}
          >
            <UploadCloud className="size-4" aria-hidden="true" />
            Upload prescription
          </Button>
        </div>
      </motion.section>
    </div>
  )
}
