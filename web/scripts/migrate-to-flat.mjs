/**
 * One-shot migration: retire the pre-pivot dark/glass class vocabulary.
 *
 * Every change here is a pure rename or removal — no markup restructuring —
 * so it is safe to re-run: already-migrated files simply match nothing.
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join, extname, relative } from 'node:path'

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

/** Rewrites `className="..."` values, dropping or swapping whole tokens. */
function mapClassNames(text, tokenMap) {
  return text.replace(/className=(["'`])([^"'`]*)\1/g, (whole, quote, body) => {
    const next = body
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => (token in tokenMap ? tokenMap[token] : token))
      .filter(Boolean)
      .join(' ')
    return `className=${quote}${next}${quote}`
  })
}

// token -> replacement ('' removes the token)
const RENAMES = {
  // Old inverted band -> the flat sage block.
  'band-light': 'band-sage',
  // Colour-scheme helpers are implicit now: the band owns its text colours.
  'on-light': '',
  // Glow was the aurora/glass vocabulary. Flat cards need no modifier.
  'card--glow': '',
  'split__glow': '',
  'cta__halo': '',
  'plan__list--light': '',
  // Accent tags mapped onto the flat palette.
  'tag--cyan': 'tag--moss',
  'tag--mint': 'tag--lime',
  'tag--violet': 'tag--forest'
}

// These were standalone decorative elements inside other markup.
const STRIP_ELEMENTS = [
  /^[^\S\n]*<span className="cta__halo" aria-hidden="true" \/>\r?\n/gm,
  /^[^\S\n]*<span className="split__glow" aria-hidden="true" \/>\r?\n/gm
]

let changed = 0
for (const file of walk(SRC)) {
  if (!['.jsx', '.js'].includes(extname(file))) continue
  const before = readFileSync(file, 'utf8')
  let after = mapClassNames(before, RENAMES)
  for (const pattern of STRIP_ELEMENTS) after = after.replace(pattern, '')
  if (after !== before) {
    writeFileSync(file, after, 'utf8')
    changed += 1
    console.log(`  migrated  ${relative(ROOT, file)}`)
  }
}

console.log(`\n${changed} file(s) updated.`)
