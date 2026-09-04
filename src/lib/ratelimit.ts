// ---------- Fixed-window rate limiting + failed-login lockout ----------
//
// Process-local, in-memory counters. That is a deliberate trade, not an oversight:
// there is no Redis or KV store in this deployment, so the state resets on restart
// and is NOT shared between instances. It still closes the case this exists for —
// a single box being walked through a password list — because every attempt on that
// box goes through the same map. A horizontally scaled deploy needs a shared store;
// see the note in `src/app/api/auth/route.ts`.
//
// Two mechanisms, used together on login:
//   consume()  — a per-IP request budget, so the expensive scrypt call cannot be
//                triggered thousands of times a second (see the CPU note below).
//   lockout    — a per-account failure counter, so a distributed attacker who
//                spreads attempts across IPs still cannot grind one account.

/** One fixed window's worth of hits for a bucket key. */
interface Window {
  count: number
  resetAt: number
}

const windows = new Map<string, Window>()
const failures = new Map<string, Window>()

/** Entries are only ever read by key, so expired ones are swept lazily. */
const SWEEP_EVERY = 500
let opsSinceSweep = 0

function sweep(now: number): void {
  if (++opsSinceSweep < SWEEP_EVERY) return
  opsSinceSweep = 0
  for (const [key, w] of windows) if (w.resetAt <= now) windows.delete(key)
  for (const [key, w] of failures) if (w.resetAt <= now) failures.delete(key)
}

export interface RateResult {
  ok: boolean
  /** Whole seconds until the window resets. 0 when `ok`. */
  retryAfter: number
}

const allowed: RateResult = { ok: true, retryAfter: 0 }

function hit(store: Map<string, Window>, key: string, limit: number, windowMs: number): RateResult {
  const now = Date.now()
  sweep(now)
  const existing = store.get(key)
  if (!existing || existing.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return allowed
  }
  existing.count++
  if (existing.count > limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) }
  }
  return allowed
}

/**
 * Spend one unit of `key`'s budget: `limit` requests per `windowMs`.
 * Counts every attempt, successful or not — this is the request-rate guard.
 */
export function consume(key: string, limit: number, windowMs: number): RateResult {
  return hit(windows, key, limit, windowMs)
}

/**
 * Whether `key` is currently locked out, WITHOUT recording anything.
 * Call before doing the expensive work; call recordFailure() after a failure.
 */
export function isLockedOut(key: string, limit: number, windowMs: number): RateResult {
  const now = Date.now()
  const existing = failures.get(key)
  if (!existing || existing.resetAt <= now) return allowed
  if (existing.count < limit) return allowed
  return { ok: false, retryAfter: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) }
}

/** Record one failed attempt for `key`. The window restarts only once it has expired. */
export function recordFailure(key: string, windowMs: number): void {
  const now = Date.now()
  sweep(now)
  const existing = failures.get(key)
  if (!existing || existing.resetAt <= now) {
    failures.set(key, { count: 1, resetAt: now + windowMs })
    return
  }
  existing.count++
}

/** Forget `key`'s failures — call on a successful authentication. */
export function clearFailures(key: string): void {
  failures.delete(key)
}

/**
 * Best-effort client identity for rate-limit keys.
 *
 * Behind the reverse proxy the socket address is always the proxy, so a forwarded header
 * is the only signal available. The Caddyfile sets `X-Forwarded-For {remote_host}`, which
 * *replaces* whatever the client sent — so on that path the value is trustworthy. Reach
 * the Next server directly (dev, or a misconfigured deploy) and it becomes client-supplied
 * and spoofable, and requests with no header at all collapse into one shared 'unknown'
 * bucket. Both cases weaken the per-IP budget but not the per-account lockout, which is
 * why login uses the two together.
 */
export function clientKey(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for')
  if (fwd) {
    const first = fwd.split(',')[0]?.trim()
    if (first) return first
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown'
}
