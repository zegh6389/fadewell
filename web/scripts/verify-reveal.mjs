/**
 * Verify the mask-based reveal: does it fire, and does it still look hidden
 * before it fires? Captures screenshots either side of the reveal.
 */

import { chromium } from '@playwright/test'

const URL = process.env.PROBE_URL ?? 'http://127.0.0.1:5173/'

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

await page.goto(URL, { waitUntil: 'networkidle' })

// Before reveal: the element must be visually hidden but geometrically present.
const before = await page.evaluate(() => {
  const el = document.querySelector('.story__step')
  el.scrollIntoView({ block: 'center', behavior: 'instant' })
  return new Promise((resolve) =>
    setTimeout(() => {
      const r = el.getBoundingClientRect()
      resolve({
        className: el.className,
        opacity: getComputedStyle(el).opacity,
        maskSize: getComputedStyle(el).maskSize,
        height: Math.round(r.height)
      })
    }, 400)
  )
})

// After reveal: it must have is-in, full opacity, and a full-size mask.
await page.waitForTimeout(1500)
const after = await page.evaluate(() => {
  const el = document.querySelector('.story__step')
  const cs = getComputedStyle(el)
  return { className: el.className, opacity: cs.opacity, maskSize: cs.maskSize }
})

console.log('before reveal:', JSON.stringify(before))
console.log('after  reveal:', JSON.stringify(after))

await page.locator('.story').scrollIntoViewIfNeeded()
await page.waitForTimeout(1200)
await page.screenshot({ path: 'test-results/reveal-check.png' })

// How many reveal elements are still hidden down the page?
const stuck = await page.evaluate(() => {
  const all = [...document.querySelectorAll('[data-reveal]')]
  return {
    total: all.length,
    revealed: all.filter((n) => n.classList.contains('is-in')).length
  }
})
console.log('reveal state:', JSON.stringify(stuck))
console.log('console errors:', errors.length ? errors : 'none')

await browser.close()
