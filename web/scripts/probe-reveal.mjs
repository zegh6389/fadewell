/**
 * Diagnostic probe: why do plain `data-reveal` elements never receive `.is-in`?
 *
 * Hypothesis under test: the default reveal style uses
 * `clip-path: inset(0 0 100% 0)`, which collapses the element's visible rect
 * to zero. If the engine folds a target's own clip-path into the intersection
 * rectangle, IntersectionObserver can never report a non-zero ratio and the
 * reveal never fires.
 */

import { chromium } from '@playwright/test'

const URL = process.env.PROBE_URL ?? 'http://127.0.0.1:5173/'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

await page.goto(URL, { waitUntil: 'networkidle' })

const target = page.locator('.story__step').first()
await target.scrollIntoViewIfNeeded()
await page.waitForTimeout(1200)

const report = await page.evaluate(async () => {
  const el = document.querySelector('.story__step')
  const cs = getComputedStyle(el)
  const r = el.getBoundingClientRect()

  // Does this engine fold the target's own clip-path into the intersection?
  const ratio = await new Promise((resolve) => {
    const io = new IntersectionObserver(
      (entries) => resolve(entries[0].intersectionRatio),
      { threshold: [0, 0.01, 0.08, 1] }
    )
    io.observe(el)
    setTimeout(() => resolve(-1), 2000)
  })

  return {
    className: el.className,
    opacity: cs.opacity,
    clipPath: cs.clipPath,
    rect: { top: Math.round(r.top), height: Math.round(r.height), width: Math.round(r.width) },
    inViewport: r.top < innerHeight && r.bottom > 0,
    intersectionRatio: ratio
  }
})

console.log('--- with clip-path wipe (current) ---')
console.log(JSON.stringify(report, null, 2))

// Now remove the clip-path and re-measure the same node.
await page.evaluate(() => {
  document.querySelectorAll('[data-reveal]').forEach((n) => {
    n.style.clipPath = 'none'
  })
})
await page.waitForTimeout(800)

const after = await page.evaluate(async () => {
  const el = document.querySelector('.story__step')
  const ratio = await new Promise((resolve) => {
    const io = new IntersectionObserver(
      (entries) => resolve(entries[0].intersectionRatio),
      { threshold: [0, 0.01, 0.08] }
    )
    io.observe(el)
    setTimeout(() => resolve(-1), 2000)
  })
  return { className: el.className, intersectionRatio: ratio }
})

console.log('\n--- with clip-path forced to none ---')
console.log(JSON.stringify(after, null, 2))

await browser.close()
