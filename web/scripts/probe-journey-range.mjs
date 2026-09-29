/**
 * Why the journey's "start untranslated" assertion drifted.
 *
 * Compares the three ways of naming the start of the pinned range, so it is
 * obvious which one is lying.
 *
 *   PROBE_URL=http://127.0.0.1:4173 node scripts/probe-journey-range.mjs
 */

import { chromium } from '@playwright/test'

const base = process.env.PROBE_URL ?? 'http://127.0.0.1:4173'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

await page.goto(`${base}/`, { waitUntil: 'networkidle' })

const report = await page.evaluate(() => {
  const section = document.querySelector('.journey')
  const pin = document.querySelector('.journey__pin') ?? document.querySelector('.pin-track')
  const track = document.querySelector('.journey__track')

  // Walk up looking for anything that would break offsetTop.
  const ancestors = []
  for (let node = section.parentElement; node; node = node.parentElement) {
    const cs = getComputedStyle(node)
    if (
      cs.transform !== 'none' ||
      cs.filter !== 'none' ||
      cs.perspective !== 'none' ||
      cs.contain.includes('paint') ||
      cs.contain.includes('layout') ||
      cs.willChange !== 'auto'
    ) {
      ancestors.push({
        tag: node.tagName,
        cls: node.className,
        transform: cs.transform,
        filter: cs.filter,
        contain: cs.contain,
        willChange: cs.willChange
      })
    }
  }

  const publishedStart = parseFloat(
    getComputedStyle(section).getPropertyValue('--journey-range-start')
  )
  const publishedEnd = parseFloat(
    getComputedStyle(section).getPropertyValue('--journey-range-end')
  )
  const docTop = Math.round(section.getBoundingClientRect().top + window.scrollY)

  return {
    docTopFromRect: docTop,
    offsetTop: section.offsetTop,
    offsetParent: section.offsetParent?.className || section.offsetParent?.tagName || 'none',
    publishedStart,
    publishedEnd,
    publishedStartMatchesDocTop: Math.abs(publishedStart - docTop) < 1,
    offsetTopMatchesDocTop: Math.abs(section.offsetTop - docTop) < 1,
    sectionHeight: section.offsetHeight,
    pinHeight: pin?.offsetHeight,
    computedEnd: docTop + section.offsetHeight - (pin?.offsetHeight ?? 0),
    offsetTopBasedEnd: section.offsetTop + (section.offsetHeight - (pin?.offsetHeight ?? 0)),
    trackOverflow: getComputedStyle(track).getPropertyValue('--track-overflow').trim(),
    gutter: getComputedStyle(track).getPropertyValue('--journey-gutter').trim(),
    breakingAncestors: ancestors
  }
})

console.log(JSON.stringify(report, null, 2))

// Sample the track at each candidate "start" to see which one is really zero.
const at = async (top) => {
  await page.evaluate((t) => window.scrollTo({ top: t, behavior: 'instant' }), top)
  await page.waitForTimeout(400)
  return page.evaluate(() => {
    const track = document.querySelector('.journey__track')
    return new DOMMatrixReadOnly(getComputedStyle(track).transform).m41
  })
}

console.log('\ntranslateX at each candidate start:')
for (const [label, top] of [
  ['publishedStart', report.publishedStart],
  ['docTopFromRect', report.docTopFromRect],
  ['offsetTop', report.offsetTop]
]) {
  console.log(`  ${label.padEnd(15)} scrollY=${Math.round(top)}  translateX=${await at(top)}`)
}

await browser.close()
