/**
 * Launch the standalone production server.
 *
 * `NODE_ENV=production <cmd>` is POSIX shell syntax that cmd.exe rejects, and the old
 * script also invoked `bun`, which is not necessarily installed. Setting the variable
 * here and importing the server under the current Node runtime works everywhere.
 *
 * The container deploy still goes through .zscripts/start.sh, which has its own
 * environment checks — this is the local and generic-host entry point.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

process.env.NODE_ENV ??= 'production'

const ENTRY = '.next/standalone/server.js'

if (!existsSync(ENTRY)) {
  console.error(`Cannot find ${ENTRY}.`)
  console.error('Run `npm run build` first — and note that a build with VERCEL set does')
  console.error('not emit a standalone server, because Vercel supplies its own runtime.')
  process.exit(1)
}

await import(pathToFileURL(resolve(ENTRY)).href)
