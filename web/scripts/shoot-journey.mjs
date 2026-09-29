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
/**
 * Wait until the page has stopped changing height.
 *
 * The journey's scroll range is an absolute offset, so anything that still
 * reflows above it moves the whole section. A section that loads live data
 * settles into its final height a beat after `networkidle`, and sampling the
 * range before then reads a start that is ~55px stale — which is what made this
 * probe report the track 24px already across at the exact start of the range,
 * about one run in five. Waiting for the document to hold still is the honest
 * fix: the measurement itself is unchanged, it is just taken against a layout
 * that has finished.
 */
async function waitForStableLayout() {
  await page.waitForFunction(
    () =>
      new Promise((done) => {
        const height = document.documentElement.scrollHeight
        let stable = 0
        const tick = () => {
          stable = document.documentElement.scrollHeight === height ? stable + 1 : 0
          if (stable >= 6) done(true)
          else setTimeout(tick, 60)
        }
        setTimeout(tick, 60)
      }),
    undefined,
    { timeout: 10_000, polling: 'raf' }
  )
}

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await mkdir(OUT, { recursive: true })

/**
 * Prime the compositor before measuring anything. Frame counting cannot fix a
 * late attach — the lag is unbounded — so scroll past the section and back to
 * force the scroll-driven animation on deterministically.
 */
await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }))
await page.waitForTimeout(200)
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
await page.waitForTimeout(200)
await waitForStableLayout()

const geo = await page.evaluate(() => {
  const j = document.querySelector('.journey')
  const track = document.querySelector('.pin-track')
  const view = track.parentElement
  const pin = view.closest('.journey__pin')
  const rule = pin.querySelector('.journey__progress')
  const ruleRect = rule.getBoundingClientRect()
  const cs = getComputedStyle(j)
  return {
    top: j.offsetTop,
    height: j.offsetHeight,
    // The distance the track has to travel for the last panel to sit flush.
    overflow: track.scrollWidth - view.clientWidth,
    // The content column, straight off the progress rule.
    columnLeft: Math.round(ruleRect.left),
    columnRight: Math.round(ruleRect.right),
    // What the app published, and what CSS is actually consuming, so a
    // mismatch with `top` shows up here instead of as a mysterious offset.
    publishedStart: cs.getPropertyValue('--journey-range-start').trim(),
    publishedEnd: cs.getPropertyValue('--journey-range-end').trim(),
    animationRange: getComputedStyle(track).animationRange,
    pinHeight: pin.offsetHeight
  }
})
console.log(`journey top=${geo.top} height=${geo.height} travel=${geo.overflow}px`)
console.log(`published range = ${geo.publishedStart} .. ${geo.publishedEnd}`)
console.log(`css animation-range = ${geo.animationRange}   pin=${geo.pinHeight}`)
console.log(`content column = ${geo.columnLeft}..${geo.columnRight}\n`)

const failures = []
const STEPS = 5

/**
 * `html` sets `scroll-behavior: smooth`, so a plain scrollTo animates and any
 * sample taken on a timer can catch the track mid-flight. Jump instantly, then
 * wait for the scroll position to actually settle before reading.
 *
 * Waiting on `window.scrollY` alone is not enough. The scroll position and the
 * scroll-driven animation are applied in different frames, so a single
 * `requestAnimationFrame` can land after the position settles but before the
 * compositor has written the new transform — which read as the track being
 * 24px already across at the very start of the range, a failure that was never
 * real. So wait until the transform stops changing.
 */
async function scrollTo(y) {
  await page.evaluate((target) => window.scrollTo({ top: target, behavior: 'instant' }), y)
  await page.waitForFunction(
    (target) => Math.abs(window.scrollY - target) < 1,
    y,
    { timeout: 5000 },
  )
  await page.waitForFunction(
    () =>
      new Promise((done) => {
        const track = document.querySelector('.pin-track')
        const read = () => getComputedStyle(track).transform
        // Three matching frames in a row, not two. The scroll position and the
        // scroll-driven animation land in different frames, and on the very
        // first scroll after load the compositor can be two or three frames
        // behind — a two-frame check still sampled 24px of travel that had not
        // happened yet, which read as a real failure at the range start.
        let last = read()
        let stable = 0
        const tick = () => {
          const now = read()
          stable = now === last ? stable + 1 : 0
          last = now
          if (stable >= 2) done(true)
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
    undefined,
    { timeout: 5000, polling: 'raf' }
  )
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
