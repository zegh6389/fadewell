/**
 * Measure the featured pricing card, in the browser, with axe.
 *
 * Guessing at a token's hex value and computing a ratio by hand is how you end
 * up "fixing" a colour that was never the problem. This reads the real computed
 * values out of the page and asks axe what it thinks.
 *
 *   PROBE_URL=http://127.0.0.1:4173 node scripts/probe-pricing-contrast.mjs
 */

import { chromium } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const base = (process.env.PROBE_URL ?? 'http://127.0.0.1:4173').replace(/\/+$/, '')
const browser = await chromium.launch()
// axe-core needs a context it can inject into, so this cannot be `newPage()`.
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()

await page.goto(`${base}/pricing`, { waitUntil: 'networkidle' })

const card = page.locator('.plan--featured')
await card.scrollIntoViewIfNeeded()
await page.waitForTimeout(400)

// What the browser actually painted.
const painted = await page.evaluate(() => {
  const el = document.querySelector('.plan--featured')
  const bg = getComputedStyle(el).backgroundColor
  const read = (sel) => {
    const node = el.querySelector(sel)
    if (!node) return null
    const cs = getComputedStyle(node)
    return {
      sel,
      color: cs.color,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      opacity: cs.opacity,
      text: node.textContent.trim().slice(0, 44)
    }
  }
  return {
    cardBackground: bg,
    // Is the badge clipped by the card?
    badge: (() => {
      const b = el.querySelector('.plan__badge')
      if (!b) return null
      const br = b.getBoundingClientRect()
      const cr = el.getBoundingClientRect()
      return {
        text: b.textContent.trim(),
        badgeTop: Math.round(br.top),
        cardTop: Math.round(cr.top),
        clippedAbove: Math.round(cr.top - br.top),
        overflow: getComputedStyle(el).overflow,
        position: getComputedStyle(el).position
      }
    })(),
    parts: ['.plan__name', '.plan__price small', '.plan__desc', '.plan__list li', '.plan__tick']
      .map(read)
      .filter(Boolean)
  }
})

console.log('--- what the browser painted ---')
console.log(JSON.stringify(painted, null, 2))

const results = await new AxeBuilder({ page })
  .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
  .include('.plan--featured')
  .analyze()

// axe only reports failures, so compute the ratio of every painted part too —
// "it passes" and "it looks washed out" are different questions and this card
// is the second one.
const relativeLuminance = (rgb) => {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
// Computed colours are usually `rgb()`/`rgba()`, but a transparent or gradient
// value carries no channels at all. Return null rather than throwing on `.slice`
// of a null match, so the caller can skip the part instead of crashing the probe.
const parse = (value) => {
  const parts = (value.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number)
  return parts.length === 3 ? parts : null
}
const ratio = (a, b) => {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

console.log('\n--- every painted part, measured ---')
const bg = parse(painted.cardBackground)
if (!bg) {
  console.log(`card background ${painted.cardBackground} carries no rgb channels; skipping measurement.`)
} else {
  for (const p of painted.parts) {
    const fg = parse(p.color)
    if (!fg) {
      console.log(`  ${p.sel.padEnd(22)} ${p.color.padEnd(20)} skipped — no rgb channels`)
      continue
    }
    const r = ratio(fg, bg)
    const large = parseFloat(p.fontSize) >= 24
    const needed = large ? 3 : 4.5
    console.log(
      `  ${p.sel.padEnd(22)} ${p.color.padEnd(20)} ${r.toFixed(2)}:1  needs ${needed}:1  ${r >= needed ? 'ok' : 'FAIL'}`
    )
  }
}

console.log('\n--- axe on the featured card ---')
if (!results.violations.length) {
  console.log('no violations')
}
for (const v of results.violations) {
  console.log(`\n${v.id}  (${v.impact})  ${v.nodes.length} node(s)`)
  for (const n of v.nodes.slice(0, 8)) {
    const d = n.any?.[0]?.data ?? n.all?.[0]?.data ?? {}
    console.log(`  ${String(d.fgColor)} on ${String(d.bgColor)}  ratio ${d.contrastRatio} (needs ${d.expectedContrastRatio})`)
    console.log(`    ${n.html.slice(0, 100)}`)
  }
}

await page.screenshot({ path: 'artifacts/browser/pricing-featured-card.png', clip: (await card.boundingBox()) ?? undefined })
await browser.close()
