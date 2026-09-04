/**
 * Copy static assets into the standalone bundle after `next build`.
 *
 * Two reasons this is a script rather than a shell one-liner:
 *
 *  1. `output: "standalone"` is skipped on Vercel (see next.config.ts), so
 *     `.next/standalone` does not exist there. The old unconditional `cp` failed the
 *     whole build. Absent that directory there is simply nothing to do.
 *  2. `cp -r` does not exist in cmd.exe, so the previous build could not run on Windows
 *     outside a POSIX shell. `fs.cpSync` behaves the same on every platform.
 */
import { existsSync, cpSync } from 'node:fs'

const STANDALONE = '.next/standalone'

if (!existsSync(STANDALONE)) {
  console.log('postbuild: no .next/standalone — not a standalone build, nothing to copy')
  process.exit(0)
}

cpSync('.next/static', `${STANDALONE}/.next/static`, { recursive: true })
console.log('postbuild: copied .next/static')

if (existsSync('public')) {
  cpSync('public', `${STANDALONE}/public`, { recursive: true })
  console.log('postbuild: copied public')
}
