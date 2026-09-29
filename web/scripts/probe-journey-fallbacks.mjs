/**
 * The journey has two non-pinned fallbacks — `prefers-reduced-motion` and
 * narrow viewports — and in both the track must be reachable by scrolling
 * rather than pinned. Zeroing the animation duration makes a scroll-driven
 * animation jump to its FINAL keyframe, which would park the track at the far
 * end and hide steps 1-3 permanently, so this asserts the content is actually
 * on screen and horizontally scrollable.
 */
import { chromium } from 'playwright'

const BASE = (process.env.PROBE_URL || 'http://127.0.0.1:4173').replace(/\/+$/, '')
const browser = await chromium.launch()
let failed = false

for (const mode of [
  { name: 'reduced-motion', opts: { reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } } },
  { name: 'narrow', opts: { viewport: { width: 390, height: 844 } } },
]) {
  const ctx = await browser.newContext(mode.opts)
  const page = await ctx.newPage()
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.locator('.journey').scrollIntoViewIfNeeded()
  await page.waitForTimeout(700)

  const r = await page.evaluate(() => {
    const view = document.querySelector('.journey__viewport')
    const track = document.querySelector('.pin-track')
    const panels = [...document.querySelectorAll('.journey__panel')]
    const first = panels[0].getBoundingClientRect()
    const last = panels[panels.length - 1].getBoundingClientRect()
    return {
      translateX: Math.round(
        new DOMMatrixReadOnly(getComputedStyle(track).transform).m41
      ),
      pinPosition: getComputedStyle(document.querySelector('.journey__pin')).position,
      sectionHeight: Math.round(document.querySelector('.journey').offsetHeight),
      // A cut-off left edge is the signature of a track parked mid-travel.
      firstLeft: Math.round(first.left),
      firstRight: Math.round(first.right),
      lastRight: Math.round(last.right),
      // Must genuinely scroll, not just report a wider scrollWidth.
      canScroll: view.scrollWidth - view.clientWidth,
      atStart: view.scrollLeft,
      progressShown: getComputedStyle(document.querySelector('.journey__progress')).display,
      tabbable: view.getAttribute('tabindex'),
    }
  })

  // Scroll the native scroller to the end and confirm step 5 is now on screen.
  await page.evaluate(() => {
    const v = document.querySelector('.journey__viewport')
    v.scrollLeft = v.scrollWidth
  })
  await page.waitForTimeout(400)
  const scrolled = await page.evaluate(() => {
    const panels = [...document.querySelectorAll('.journey__panel')]
    const last = panels[panels.length - 1].getBoundingClientRect()
    return { lastRight: Math.round(last.right), lastLeft: Math.round(last.left) }
  })

  const ok = r.translateX === 0
    && r.pinPosition === 'static'
    && r.firstLeft >= -1
    && r.canScroll > 0
    && r.tabbable === '0'
    && scrolled.lastRight <= r.lastRight
  if (!ok) failed = true

  console.log(`${mode.name}:`)
  console.log(`  pin=${r.pinPosition} trackX=${r.translateX} sectionH=${r.sectionHeight}`)
  console.log(`  first panel=[${r.firstLeft}..${r.firstRight}]  last panel right=${r.lastRight}`)
  console.log(`  scrollable=${r.canScroll}px  progress rule=${r.progressShown}  tabindex=${r.tabbable}`)
  console.log(`  after scrolling to end: last panel=[${scrolled.lastLeft}..${scrolled.lastRight}]`)
  console.log(`  ${ok ? 'ok' : 'FAILED — a step is unreachable'}\n`)

  await ctx.close()
}

await browser.close()
process.exit(failed ? 1 : 0)
