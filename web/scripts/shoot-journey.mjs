/**
 * Verify the pinned horizontal journey.
 *
 * Two things a single screenshot can never prove:
 *   1. the track actually travels (0 -> the measured travel distance)
 *   2. the first and last panels come to rest on the content column, so their
 *      rounded corners are not clipped at the two moments the reader looks
 *
 * The reference for (2) is the progress rule under the pin, not a hardcoded
 * number — the column moves with the gutter token and the shell max-width.
 *
 *   node scripts/shoot-journey.mjs            # expects a server on :4173
 *   PROBE_URL=http://127.0.0.1:5173 node scripts/shoot-journey.mjs
 */
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const BASE = (process.env.PROBE_URL || 'http://127.0.0.1:4173').replace(/\/+$/, '')
const OUT = new URL('../artifacts/journey/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const TOL = 3 // px, sub-pixel layout rounding

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await mkdir(OUT, { recursive: true })

const geo = await page.evaluate(() => {
  const j = document.querySelector('.journey')
  const track = document.querySelector('.pin-track')
  const view = track.parentElement
  const rule = view.closest('.journey__pin').querySelector('.journey__progress')
  const ruleRect = rule.getBoundingClientRect()
  return {
    top: j.offsetTop,
    height: j.offsetHeight,
    // The distance the track has to travel for the last panel to sit flush.
    overflow: track.scrollWidth - view.clientWidth,
    // The content column, straight off the progress rule.
    columnLeft: Math.round(ruleRect.left),
    columnRight: Math.round(ruleRect.right),
  }
})
console.log(`journey top=${geo.top} height=${geo.height} travel=${geo.overflow}px`)
console.log(`content column = ${geo.columnLeft}..${geo.columnRight}\n`)

const failures = []
const STEPS = 5

/**
 * `html` sets `scroll-behavior: smooth`, so a plain scrollTo animates and any
 * sample taken on a timer can catch the track mid-flight. Jump instantly, then
 * wait for the scroll position to actually settle before reading.
 */
async function scrollTo(y) {
  await page.evaluate((target) => window.scrollTo({ top: target, behavior: 'instant' }), y)
  await page.waitForFunction(
    (target) => Math.abs(window.scrollY - target) < 1,
    y,
    { timeout: 5000 },
  )
  // One more frame so the compositor has applied the scroll-driven animation.
  await page.evaluate(() => new Promise(requestAnimationFrame))
}

for (let i = 0; i <= STEPS; i += 1) {
  const y = Math.round(geo.top + ((geo.height - 900) * i) / STEPS)
  await scrollTo(y)

  const m = await page.evaluate(() => {
    const read = (sel) => {
      const el = document.querySelector(sel)
      const r = el.getBoundingClientRect()
      return { left: Math.round(r.left), right: Math.round(r.right) }
    }
    return {
      trackX: Math.round(new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.pin-track')).transform).m41),
      first: read('.journey__panel:first-of-type'),
      last: read('.journey__panel:last-of-type'),
    }
  })

  await page.screenshot({ path: `${OUT}journey-${i}-y${y}.png` })

  if (i === 0) {
    if (Math.abs(m.first.left - geo.columnLeft) > TOL) {
      failures.push(`start: first panel left=${m.first.left}, column=${geo.columnLeft} (corner clipped)`)
    }
    if (Math.abs(m.trackX) > TOL) failures.push(`start: track already translated ${m.trackX}px`)
  }
  if (i === STEPS) {
    if (Math.abs(m.last.right - geo.columnRight) > TOL) {
      failures.push(`end: last panel right=${m.last.right}, column=${geo.columnRight} (corner clipped)`)
    }
    if (Math.abs(-m.trackX - geo.overflow) > TOL) {
      failures.push(`end: track travelled ${-m.trackX}px of ${geo.overflow}px`)
    }
  }
  console.log(`  step ${i}  y=${String(y).padStart(4)}  trackX=${String(m.trackX).padStart(5)}`
    + `  first.left=${m.first.left}  last.right=${m.last.right}`)
}

await browser.close()
console.log(`\nwrote ${STEPS + 1} frames to ${OUT}`)
if (failures.length) {
  console.error(`\nJOURNEY FAILED\n  - ${failures.join('\n  - ')}`)
  process.exit(1)
}
console.log('JOURNEY OK — travels full distance, both ends land on the content column')
