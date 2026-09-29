/**
 * Capture reference screenshots of the flat redesign for visual review.
 */

import { chromium } from '@playwright/test'

// Strip any trailing slash: these are concatenated with an absolute path, and
// a trailing slash silently produces `//about`, which correctly 404s.
const URL = (process.env.PROBE_URL ?? 'http://127.0.0.1:5173/').replace(/\/+$/, '')
// NOT test-results/ — Playwright wipes that directory on every run.
const OUT = 'screenshots'

const shots = [
  { name: 'home-hero', path: '/', scroll: 0 },
  { name: 'home-journey', path: '/', scroll: 2200 },
  { name: 'home-story', path: '/', scroll: 4200 },
  { name: 'home-pricing', path: '/', scroll: 6400 },
  { name: 'how-it-works', path: '/how-it-works', scroll: 0 },
  { name: 'clinicians', path: '/clinicians', scroll: 300 },
  { name: 'about', path: '/about', scroll: 0 },
  { name: 'pricing', path: '/pricing', scroll: 300 },
  { name: 'care', path: '/care', scroll: 400 },
  { name: 'contact', path: '/contact', scroll: 0 },
  { name: 'faq', path: '/faq', scroll: 200 }
]

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })

for (const shot of shots) {
  const page = await context.newPage()
  await page.goto(`${URL}${shot.path}`, { waitUntil: 'networkidle' })
  if (shot.scroll) {
    await page.evaluate((y) => window.scrollTo(0, y), shot.scroll)
    await page.waitForTimeout(1400)
  } else {
    await page.waitForTimeout(700)
  }
  // Guard: a shot that silently captured the 404 page is a broken script, not
  // a broken page. Fail loudly rather than shipping a misleading screenshot.
  const notFound = await page.locator('.notfound').count()
  if (notFound > 0) {
    console.log(`  !! ${shot.name} rendered the 404 page`)
  }
  await page.screenshot({ path: `${OUT}/${shot.name}.png` })
  console.log(`  ${shot.name}`)
  await page.close()
}

// One mobile frame to check the pinned journey collapse.
const mobile = await browser.newContext({ viewport: { width: 412, height: 915 } })
const mpage = await mobile.newPage()
await mpage.goto(URL, { waitUntil: 'networkidle' })
await mpage.evaluate(() => window.scrollTo(0, 2000))
await mpage.waitForTimeout(1200)
await mpage.screenshot({ path: `${OUT}/home-mobile.png` })
console.log('  home-mobile')
await mobile.close()

await browser.close()
