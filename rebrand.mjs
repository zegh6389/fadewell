/**
 * One-shot rebrand: MmjGreen -> MmjGreen, mmjgreen.com -> mmjgreen.com.
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
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = 'C:/Users/Awais/MmjGreen.com'
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'artifacts', 'shots', 'screenshots',
  'test-results', 'playwright-report', '.vite', 'coverage'
])
// Captured logs from past runs — rewriting them would falsify the record.
const SKIP_FILES = new Set(['e2e-out.txt', 'e2e-mobile.txt', 'build-out.txt', 'deep-audit-out.txt'])

// token -> replacement, applied in this order (longest / most specific first)
const RULES = [
  ['mmjgreen.com', 'mmjgreen.com'],
  ['MMJGREEN.COM', 'MMJGREEN.COM'],
  ['MMJGREEN', 'MMJGREEN'],
  ['MmjGreen', 'MmjGreen'],
  ['mmjgreen', 'mmjgreen']
]

// file -> array of literal strings to restore after the bulk pass
const PROTECT = {
  'api/src/delivery.ts': ['"mmjgreen:recipient-hmac:v1"'],
  'api/deploy/heroku.ps1': ["'mmjgreen-api'"]
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
