import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'

import { STOCK_MOVEMENT_REASONS } from './types.ts'

/**
 * The Stock Log's reason filter drifted out of sync with the code that writes
 * movements: PO_RECEIVE — the main way stock arrives — was being recorded but was
 * absent from the UI's list, so those rows rendered with a raw enum label and could
 * not be filtered for. STOCK_MOVEMENT_REASONS is now the single source of truth.
 *
 * These tests guard the two ways that can rot again: a reason written by a route but
 * missing from the list, and a reason in the list with no label in the Stock Log.
 * They read the source files rather than importing them, because the routes pull in
 * Prisma and the components are JSX — neither loads under the plain Node test runner.
 */

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')

describe('STOCK_MOVEMENT_REASONS', () => {
  it('has no duplicates', () => {
    assert.equal(new Set(STOCK_MOVEMENT_REASONS).size, STOCK_MOVEMENT_REASONS.length)
  })

  it('includes PO_RECEIVE — the regression this list exists to prevent', () => {
    assert.ok(STOCK_MOVEMENT_REASONS.includes('PO_RECEIVE'))
  })

  it('includes OPENING, without which the ledger cannot balance', () => {
    assert.ok(STOCK_MOVEMENT_REASONS.includes('OPENING'))
  })

  it('covers every reason the API routes actually write', () => {
    const routes = ['../app/api/admin/route.ts', '../app/api/orders/route.ts', '../app/api/pharmacist/route.ts', '../app/api/_lib.ts']
    const written = new Set<string>()
    for (const file of routes) {
      for (const m of read(file).matchAll(/reason:\s*'([A-Z_]+)'/g)) written.add(m[1])
    }

    assert.ok(written.size > 0, 'expected to find reasons written in the routes')
    const missing = [...written].filter((r) => !STOCK_MOVEMENT_REASONS.includes(r as never))
    assert.deepEqual(missing, [], `reasons written by routes but absent from STOCK_MOVEMENT_REASONS: ${missing.join(', ')}`)
  })

  it('has a Stock Log label for every reason', () => {
    const src = read('../components/pharmacist/StockLog.tsx')
    const block = src.slice(src.indexOf('const REASON_META'), src.indexOf('const REASONS'))
    const labelled = new Set([...block.matchAll(/^\s{2}([A-Z_]+):/gm)].map((m) => m[1]))

    const missing = STOCK_MOVEMENT_REASONS.filter((r) => !labelled.has(r))
    assert.deepEqual(missing, [], `reasons with no Stock Log label: ${missing.join(', ')}`)
  })
})

/**
 * The audit log has the same drift hazard as the stock log, in four places rather
 * than two: the AuditAction union, the admin route's AUDIT_ACTIONS filter whitelist,
 * and the audit screen's filter list and label map. An action missing from any of
 * them is written but unfindable — worse than not recording it, because the record
 * exists and nobody can retrieve it.
 */
describe('audit actions', () => {
  const union = new Set(
    [...read('./types.ts').slice(read('./types.ts').indexOf('export type AuditAction'))
      .slice(0, 500)
      .matchAll(/\|\s*'([A-Z_]+)'/g)].map((m) => m[1])
  )
  const routeList = new Set(
    [...(read('../app/api/admin/route.ts').match(/const AUDIT_ACTIONS = \[[^\]]+\]/) ?? [''])[0]
      .matchAll(/'([A-Z_]+)'/g)].map((m) => m[1])
  )
  const ui = read('../components/admin/AdminAuditLog.tsx')
  const filters = new Set([...ui.matchAll(/\{ value: '([A-Z_]+)', label:/g)].map((m) => m[1]))
  const labelBlock = ui.slice(ui.indexOf('const ACTION_LABELS'), ui.indexOf('const ACTION_TONES'))
  const labels = new Set([...labelBlock.matchAll(/^\s{2}([A-Z_]+):/gm)].map((m) => m[1]))

  it('found all four lists', () => {
    for (const [name, set] of [['union', union], ['route', routeList], ['filters', filters], ['labels', labels]] as const) {
      assert.ok(set.size > 5, `${name} list looks empty (${set.size}) — the parser needs updating`)
    }
  })

  it('includes the five stock request actions everywhere', () => {
    for (const a of ['SR_CREATE', 'SR_SUBMIT', 'SR_REVIEW', 'SR_CONVERT', 'SR_CANCEL']) {
      assert.ok(union.has(a), `AuditAction union missing ${a}`)
      assert.ok(routeList.has(a), `admin route AUDIT_ACTIONS missing ${a}`)
      assert.ok(filters.has(a), `audit log filter missing ${a}`)
      assert.ok(labels.has(a), `audit log label missing ${a}`)
    }
  })

  it('agrees across the union, the API filter and the screen', () => {
    for (const a of union) {
      assert.ok(routeList.has(a), `${a} is in the type but the API will not filter it`)
      assert.ok(filters.has(a), `${a} is in the type but has no filter option`)
      assert.ok(labels.has(a), `${a} is in the type but has no label`)
    }
    for (const a of routeList) assert.ok(union.has(a), `${a} is filterable but missing from AuditAction`)
  })
})
