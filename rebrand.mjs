/**
 * One-shot rebrand: FadeWell -> MmjGreen, fadewell.com -> mmjgreen.com.
 *
 * This migration has already been applied to this tree; the file is kept as the
 * record of exactly what was rewritten and what was deliberately left alone.
 * Re-running it on an already-rebranded checkout is a no-op.
 *
 * Case-preserving, ordered longest-token-first. Three identifiers are protected
 * because renaming them breaks live infrastructure rather than branding:
 *
 *   - the recipient HMAC info string in api/src/delivery.ts (changing it
 *     invalidates every stored recipient digest),
 *   - the default Heroku app name in api/deploy/heroku.ps1 (the app already
 *     exists under that name),
 *   - captured test-run logs and generated screenshot artifacts (historical
 *     records, not live branding).
 *
 * Two identifiers are intentionally NOT renamed, because they are the
 * compatibility surface that lets the rename deploy without signing everyone
 * out: the `fadewell-session` cookie read in api/src/auth.ts and the
 * `FADEWELL_ALLOW_INSECURE_TLS` fallback in api/src/config.ts.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Derived from this file's own location so a checkout at any path works.
const ROOT = dirname(fileURLToPath(import.meta.url))
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'artifacts', 'shots', 'screenshots',
  'test-results', 'playwright-report', '.vite', 'coverage'
])
// Captured logs from past runs — rewriting them would falsify the record.
// The script itself is skipped too: it necessarily contains every source token
// in RULES and PROTECT, so a pass over it would erase its own rule table.
const SKIP_FILES = new Set(['e2e-out.txt', 'e2e-mobile.txt', 'build-out.txt', 'deep-audit-out.txt', 'rebrand.mjs'])

// token -> replacement, applied in this order (longest / most specific first)
const RULES = [
  ['fadewell.com', 'mmjgreen.com'],
  ['FADEWELL.COM', 'MMJGREEN.COM'],
  ['FADEWELL', 'MMJGREEN'],
  ['FadeWell', 'MmjGreen'],
  ['fadewell', 'mmjgreen']
]

// file -> array of literal strings to restore after the bulk pass.
// These are the strings as they stood BEFORE the rename, which is what the file
// must still be matched against for the guard to do anything. Every deliberate
// `fadewell` survivor belongs here, because a re-run would otherwise rewrite
// the compatibility surface this file exists to preserve.
const PROTECT = {
  // Changing the info string invalidates every stored recipient digest.
  'api/src/delivery.ts': ['"fadewell:recipient-hmac:v1"'],
  // The app already exists on Heroku under this name.
  'api/deploy/heroku.ps1': ["'fadewell-api'"],
  // The session cookie still read so the rename cannot sign everyone out on
  // deploy. Renaming it would break exactly the rollover it exists to support.
  'api/src/auth.ts': ["'__Host-fadewell-session'", "'fadewell-session'"],
  // Same reason, for the insecure-TLS escape hatch.
  'api/src/config.ts': ['FADEWELL_ALLOW_INSECURE_TLS'],
  // This file is hashed whole — comments included — by api/src/migrate.ts, so a
  // rewrite here is a MIGRATION_CHECKSUM_MISMATCH on any database that applied it.
  'api/migrations/015_intake_state_code_promote.sql': ['FadeWell'],
  // The leak assertion names the old brand on purpose; rewriting it would make
  // the test match the current brand and fail on every page.
  'web/tests/browser/site.spec.js': ['FadeWell', 'fadewell']
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue
      walk(full, out)
    } else {
      out.push(full)
    }
  }
  return out
}

const PLACEHOLDER = (i) => `@@PROTECTED_${i}@@`
let changed = []
let totalHits = 0

for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).replace(/\\/g, '/')
  if (SKIP_FILES.has(rel.split('/').pop())) continue
  if (!/\.(ts|tsx|js|jsx|mjs|json|html|css|md|xml|txt|webmanifest|sql|ps1|yml|yaml)$/.test(file)) continue

  const original = readFileSync(file, 'utf8')
  let next = original

  // Protect, replace, restore.
  const guards = PROTECT[rel] ?? []
  guards.forEach((literal, i) => {
    next = next.split(literal).join(PLACEHOLDER(i))
  })

  let hits = 0
  for (const [from, to] of RULES) {
    const parts = next.split(from)
    hits += parts.length - 1
    next = parts.join(to)
  }

  guards.forEach((literal, i) => {
    next = next.split(PLACEHOLDER(i)).join(literal)
  })

  if (next !== original) {
    writeFileSync(file, next, 'utf8')
    changed.push({ rel, hits })
    totalHits += hits
  }
}

changed.sort((a, b) => b.hits - a.hits)
for (const { rel, hits } of changed) console.log(String(hits).padStart(3), rel)
console.log(`\n${totalHits} replacements across ${changed.length} files`)
