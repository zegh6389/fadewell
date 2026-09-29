/**
 * Probe 2: which reveal technique survives IntersectionObserver?
 *
 * `clip-path: inset(0 0 100%)` is proven to collapse the observed rect, so a
 * clip-based wipe can never trigger a threshold-gated reveal. This compares
 * candidate techniques, but only after confirming the element is genuinely on
 * screen — otherwise a ratio of 0 just means "scrolled to the wrong place".
 */

import { chromium } from '@playwright/test'

const URL = process.env.PROBE_URL ?? 'http://127.0.0.1:5173/'

const CANDIDATES = [
  { name: 'clip-path wipe', start: { clipPath: 'inset(0px 0px 100%)' } },
  {
    name: 'mask-size wipe',
    start: {
      maskImage: 'linear-gradient(#000, #000)',
      maskSize: '0% 100%',
      maskRepeat: 'no-repeat'
    }
  },
  { name: 'transform + opacity', start: { transform: 'translate3d(0, 18px, 0)', opacity: '0' } }
]

const browser = await chromium.launch()
const results = []

for (const candidate of CANDIDATES) {
  // Fresh context each time: reveal state is one-way, so reuse would poison it.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const fresh = await context.newPage()
  await fresh.goto(URL, { waitUntil: 'networkidle' })

  const result = await fresh.evaluate(async (spec) => {
    const el = document.querySelector('.story__step')

    el.scrollIntoView({ block: 'center', behavior: 'instant' })
    // Scroll settling + layout.
    await new Promise((r) => setTimeout(r, 600))

    const before = el.getBoundingClientRect()
    const onScreen = before.top < innerHeight && before.bottom > 0 && before.top > -before.height

    // Neutralise the stylesheet's clip-path wipe FIRST, otherwise every
    // candidate is still measured under the very rule being tested.
    ;['clipPath', 'maskImage', 'maskSize', 'maskRepeat', 'transform', 'opacity'].forEach((k) => {
      el.style[k] = ''
    })
    el.style.clipPath = 'none'

    for (const [prop, value] of Object.entries(spec.start)) el.style[prop] = value
    await new Promise((r) => requestAnimationFrame(r))

    const after = el.getBoundingClientRect()
    const onScreenAfter = after.top < innerHeight && after.bottom > 0

    const ratio = await new Promise((resolve) => {
      const io = new IntersectionObserver(
        (entries) => resolve(entries[0].intersectionRatio),
        { threshold: [0, 0.08] }
      )
      io.observe(el)
      setTimeout(() => resolve(-1), 1500)
    })

    return {
      onScreen,
      onScreenAfter,
      top: Math.round(after.top),
      height: Math.round(after.height),
      ratio
    }
  }, candidate)

  results.push({ name: candidate.name, ...result })
  await context.close()
}

console.table(results)
await browser.close()
