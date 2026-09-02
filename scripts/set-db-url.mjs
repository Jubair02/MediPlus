/**
 * Rewrites DATABASE_URL + DIRECT_URL in .env from a single Neon connection string.
 *
 *   node scripts/set-db-url.mjs "postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require"
 *
 * Derives the pooled runtime URL (with pgbouncer=true) and the direct URL used by
 * prisma migrate/db push, so the two can never drift apart.
 */
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'

const input = process.argv[2]
if (!input) {
  console.error('Usage: node scripts/set-db-url.mjs "<neon connection string>"')
  process.exit(1)
}

let u
try { u = new URL(input.trim()) } catch { console.error('❌ Not a valid URL. Wrap it in quotes.'); process.exit(1) }
if (!/^postgres(ql)?:$/.test(u.protocol)) { console.error(`❌ Expected a postgres:// URL, got ${u.protocol}`); process.exit(1) }
if (!u.password) { console.error('❌ No password in the connection string — copy the full one from the Neon console.'); process.exit(1) }

const pooled = new URL(u)
if (!pooled.hostname.includes('-pooler')) {
  pooled.hostname = pooled.hostname.replace(/^([^.]+)\./, '$1-pooler.')
  console.log('ℹ️  input was the direct host; derived the pooled host for runtime')
}
pooled.searchParams.set('pgbouncer', 'true')

const direct = new URL(u)
direct.hostname = direct.hostname.replace('-pooler', '')
direct.searchParams.delete('pgbouncer')

copyFileSync('.env', '.env.bak')
let env = readFileSync('.env', 'utf8')
env = env.replace(/^DATABASE_URL\s*=.*$\n?/m, '').replace(/^DIRECT_URL\s*=.*$\n?/m, '')
env = env.replace(/^#.*pooled.*$\n?/gim, '').replace(/^#.*Non-pooled.*$\n?/gim, '')
env = (env.trim() ? env.trim() + '\n' : '') +
  `DATABASE_URL="${pooled}"\n` +
  `# Non-pooled endpoint — prisma migrate/db push only (PgBouncer can't hold DDL sessions)\n` +
  `DIRECT_URL="${direct}"\n`
writeFileSync('.env', env)

const redact = (x) => { const v = new URL(x); v.password = '***'; return v.toString() }
console.log('✅ .env updated (previous saved to .env.bak)')
console.log('   DATABASE_URL →', redact(pooled.toString()))
console.log('   DIRECT_URL   →', redact(direct.toString()))
