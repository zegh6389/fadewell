/**
 * Design audit for the things a screenshot can suggest but not prove.
 *
 * Measures, rather than eyeballs:
 *   1. where the help launcher and its dialog actually sit
 *   2. every box-shadow actually in use, so outliers are visible as numbers
 *   3. what a button's hover really does — a magnetic pull and a hover lift are
 *      two transforms on one element, and it is easy to ship both
 *   4. the real height of the form fields, which is the thing people mean when
 *      they say a field looks small
 *
 *   PROBE_URL=http://127.0.0.1:4173 node scripts/probe-design.mjs
 */

import { chromium } from '@playwright/test'

const base = (process.env.PROBE_URL ?? 'http://127.0.0.1:4173').replace(/\/+$/, '')
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

await page.goto(`${base}/`, { waitUntil: 'networkidle' })
await page.waitForTimeout(600)

/* ---------- 1. help launcher and dialog ------------------------------- */

const launcher = await page.evaluate(() => {
  const el = document.querySelector('.help-launcher')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return {
    position: getComputedStyle(el).position,
    bottomGap: Math.round(window.innerHeight - r.bottom),
    rightGap: Math.round(window.innerWidth - r.right),
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
  }
})
console.log('--- help launcher ---')
console.log(JSON.stringify(launcher))

await page.locator('.help-launcher').click()
await page.waitForTimeout(500)
const dialog = await page.evaluate(() => {
  const el = document.querySelector('.help')
  if (!el) return null
  const r = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  return {
    open: el.open,
    position: cs.position,
    margin: cs.margin,
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    // How far off centre is it? 0 is dead centre.
    offsetX: Math.round(r.x + r.width / 2 - window.innerWidth / 2),
    offsetY: Math.round(r.y + r.height / 2 - window.innerHeight / 2),
    viewport: `${window.innerWidth}x${window.innerHeight}`
  }
})
console.log('\n--- help dialog when open ---')
console.log(JSON.stringify(dialog, null, 2))
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

/* ---------- 2. every shadow in use ------------------------------------ */

const shadows = await page.evaluate(() => {
  const found = new Map()
  for (const el of document.querySelectorAll('*')) {
    const s = getComputedStyle(el).boxShadow
    if (!s || s === 'none') continue
    const key = s
    if (!found.has(key)) found.set(key, [])
    const el2 = found.get(key)
    if (el2.length < 3) el2.push(el.className || el.tagName)
  }
  return [...found].map(([shadow, where]) => ({ shadow, where }))
})
console.log('\n--- distinct box-shadows on the home page ---')
for (const s of shadows) {
  console.log(`  ${s.shadow}`)
  console.log(`      ${s.where.join(', ')}`)
}

/* ---------- 3. what hover does to a button ---------------------------- */

const hover = await page.evaluate(() => {
  const btn = document.querySelector('.btn')
  if (!btn) return null
  const cs = getComputedStyle(btn)
  const t = new DOMMatrixReadOnly(cs.transform)
  return {
    className: btn.className,
    transform: cs.transform,
    translateProp: cs.translate,
    hasMagnet: btn.hasAttribute('data-magnetic') || cs.translate !== 'none',
    restingX: t.m41,
    restingY: t.m42
  }
})
console.log('\n--- button at rest ---')
console.log(JSON.stringify(hover, null, 2))

const primary = page.locator('.btn--primary:visible').first()
await primary.scrollIntoViewIfNeeded()
await page.waitForTimeout(300)
const before = await primary.evaluate((el) => {
  const r = el.getBoundingClientRect()
  return { x: Math.round(r.x), y: Math.round(r.y) }
})
await primary.hover()
await page.waitForTimeout(400)
const after = await primary.evaluate((el) => {
  const cs = getComputedStyle(el)
  const t = new DOMMatrixReadOnly(cs.transform)
  return {
    x: Math.round(el.getBoundingClientRect().x),
    y: Math.round(el.getBoundingClientRect().y),
    transformM41: Number(t.m41.toFixed(2)),
    transformM42: Number(t.m42.toFixed(2)),
    translate: cs.translate
  }
})
console.log('\n--- primary button on hover ---')
console.log(JSON.stringify({ before, after, movedX: after.x - before.x, movedY: after.y - before.y }, null, 2))

/* ---------- 4. field sizes -------------------------------------------- */

// /patient renders its session gate until you start something, so the intake
// fields do not exist yet. Measuring here without doing that returns nothing
// and looks like "there are no fields".
await page.goto(`${base}/patient`, { waitUntil: 'networkidle' })
const start = page.getByRole('button', { name: /start|begin|guest|continue/i }).first()
if (await start.count()) {
  await start.click()
  await page.waitForTimeout(2500)
}

const fields = await page.evaluate(() => {
  const out = []
  const box = (el) => el.getBoundingClientRect()

  for (const el of document.querySelectorAll('input, select, textarea, .quiz__chip')) {
    const r = box(el)
    if (r.height === 0) continue

    // A bare checkbox renders 17px and is almost never what you tap — the
    // label around it is. Measuring the input alone would report a 17px touch
    // target on a control that is actually easy to hit, which is the kind of
    // false alarm that teaches people to ignore the output. So report the
    // wrapper when there is one.
    const wrapper = el.closest('label')
    const target = wrapper && box(wrapper).height > r.height ? box(wrapper) : r

    out.push({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') ?? '',
      name: el.getAttribute('name') || el.className || '',
      h: Math.round(target.height),
      rawH: Math.round(r.height),
      viaLabel: target !== r,
      fontSize: getComputedStyle(el).fontSize
    })
  }
  return out
})
console.log('\n--- field heights on /patient ---')
if (!fields.length) {
  console.log('  (no fields rendered — the session gate is still up)')
} else {
  for (const f of fields) {
    const flag = f.h >= 44 ? 'ok  ' : 'LOW '
    const via = f.viaLabel ? `  (tapped area, box is ${f.rawH}px)` : ''
    console.log(`  ${flag} ${String(f.h).padStart(3)}px  ${f.fontSize.padStart(7)}  ${f.tag.padEnd(8)} ${f.name}${via}`)
  }
  const heights = [...new Set(fields.map((f) => f.h))].sort((a, b) => a - b)
  const low = fields.filter((f) => f.h < 44)
  console.log(`\n  distinct tapped heights: ${heights.join(', ')}`)
  console.log(`  under 44px: ${low.length ? low.map((f) => `${f.tag}.${f.name}`).join(', ') : 'none'}`)
}

await browser.close()
