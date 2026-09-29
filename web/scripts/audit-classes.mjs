/**
 * FadeWell — design-token / class audit.
 *
 * Cross-checks three things that a refactor silently breaks:
 *   1. CSS custom properties referenced with var(--x) that are not defined.
 *   2. Class names used in JSX that no stylesheet defines.
 *   3. Exported modules/hooks imported with a name that no longer exists.
 *
 * Run: node web/scripts/audit-classes.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, extname } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const SRC = join(ROOT, 'src')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const files = walk(SRC)
const css = files.filter((f) => extname(f) === '.css')
const jsx = files.filter((f) => ['.jsx', '.js'].includes(extname(f)))

const cssText = css.map((f) => readFileSync(f, 'utf8')).join('\n')
const jsText = jsx.map((f) => readFileSync(f, 'utf8')).join('\n')

let failures = 0
const fail = (msg) => {
  failures += 1
  console.log(`  FAIL  ${msg}`)
}

/* ---------- 1. defined vs referenced custom properties ---------- */

const defined = new Set()
for (const m of cssText.matchAll(/(--[a-z0-9-]+)\s*:/gi)) defined.add(m[1])
for (const m of jsText.matchAll(/setProperty\('(--[a-z0-9-]+)'/gi)) defined.add(m[1])

// A `var(--x, fallback)` supplies its own default, so it counts as defined.
for (const m of cssText.matchAll(/var\((--[a-z0-9-]+)\s*,/gi)) defined.add(m[1])
for (const m of jsText.matchAll(/var\((--[a-z0-9-]+)\s*,/gi)) defined.add(m[1])

const referenced = new Set()
for (const m of cssText.matchAll(/var\((--[a-z0-9-]+)/gi)) referenced.add(m[1])
for (const m of jsText.matchAll(/var\((--[a-z0-9-]+)/gi)) referenced.add(m[1])
for (const m of jsText.matchAll(/setProperty\('(--[a-z0-9-]+)'/gi)) referenced.add(m[1])

const undefinedVars = [...referenced].filter((v) => !defined.has(v)).sort()

console.log('\n1. CSS custom properties')
if (undefinedVars.length) {
  for (const v of undefinedVars) fail(`var(${v}) is referenced but never defined`)
} else {
  console.log(`  ok    all ${referenced.size} referenced properties are defined`)
}

/* ---------- 2. classes used in JSX but not in CSS ------------- */

const cssClasses = new Set()
for (const m of cssText.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) cssClasses.add(m[1])

// Classes that come from JS-only state strings, not stylesheets.
const STATE_ONLY = new Set(['is-in', 'is-open', 'is-active', 'is-stuck', 'is-selected', 'is-on', 'is-open'])

const used = new Map() // class -> Set(files)
for (const file of jsx) {
  const text = readFileSync(file, 'utf8')
  // className="..." and className={`...`} — capture every word that looks
  // like a BEM class, then ignore anything that is not plain lowercase-kebab.
  for (const m of text.matchAll(/className\s*=\s*(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)) {
    const raw = (m[1] || m[2] || m[3] || '')
      .replace(/\$\{[^}]*\}/g, ' ')
      .replace(/[?]/g, ' ')
    for (const token of raw.split(/\s+/)) {
      const cls = token.trim()
      if (!cls) continue
      if (!/^[a-z][a-z0-9_-]*$/.test(cls)) continue
      if (STATE_ONLY.has(cls)) continue
      // `tag--${variant}` survives interpolation stripping as a bare prefix.
      // The real class is decided at runtime, so the fragment is not a defect.
      if (cls.endsWith('--')) continue
      if (!used.has(cls)) used.set(cls, new Set())
      used.get(cls).add(relative(ROOT, file))
    }
  }
}

const missingClasses = [...used.entries()]
  .filter(([cls]) => !cssClasses.has(cls))
  .sort((a, b) => a[0].localeCompare(b[0]))

console.log('\n2. JSX classes with no stylesheet rule')
if (missingClasses.length) {
  for (const [cls, where] of missingClasses) {
    fail(`.${cls}  (${[...where].join(', ')})`)
  }
} else {
  console.log(`  ok    all ${used.size} JSX classes are styled`)
}

/* ---------- 3. named imports that do not exist ---------------- */

const exportsByFile = new Map()
for (const file of jsx) {
  const text = readFileSync(file, 'utf8')
  const names = new Set()
  for (const m of text.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z0-9_$]+)/g)) {
    names.add(m[1])
  }
  for (const m of text.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim()
      if (name) names.add(name)
    }
  }
  exportsByFile.set(file, names)
}

const badImports = []
for (const file of jsx) {
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const spec = m[2]
    if (!spec.startsWith('.')) continue
    const target = join(file, '..', spec)
    const targetPath = [target, `${target}.jsx`, `${target}.js`].find(
      (p) => {
        try {
          return statSync(p).isFile()
        } catch {
          return false
        }
      }
    )
    if (!targetPath) {
      badImports.push(`${relative(ROOT, file)} -> ${spec} (module not found)`)
      continue
    }
    const available = exportsByFile.get(targetPath)
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0]?.trim()
      if (!name) continue
      if (available && !available.has(name)) {
        badImports.push(`${relative(ROOT, file)} imports { ${name} } from ${spec} — not exported`)
      }
    }
  }
}

console.log('\n3. Local imports that resolve to a real export')
if (badImports.length) {
  for (const msg of badImports) fail(msg)
} else {
  console.log('  ok    every local named import resolves')
}

console.log(`\n${failures ? `AUDIT FAILED — ${failures} problem(s)` : 'AUDIT PASSED'}\n`)
process.exit(failures ? 1 : 0)
