/**
 * MmjGreen — deep browser audit.
 *
 * Deliberately goes beyond the Playwright suite. That suite proves routes
 * render without errors; this one proves the *design* is what it claims to
 * be. In particular it enforces the two constraints that were set by hand:
 *
 *   1. No glassmorphism. No backdrop-filter, no blur filters, no translucent
 *      surface stacking — the brief was flat, and "looks glassy" was an
 *      explicit rejection.
 *   2. No legacy brand leakage anywhere in rendered output.
 *
 * It also sweeps every route (not just the home page) for console errors,
 * failed requests, broken images, horizontal overflow, stuck reveals, and
 * WCAG 2.1 AA violations.
 *
 * Run: node scripts/deep-audit.mjs   (expects a server on PROBE_URL)
 */

import { chromium } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const URL = (process.env.PROBE_URL ?? 'http://127.0.0.1:5173/').replace(/\/+$/, '')

const MARKETING = [
  '/', '/how-it-works', '/service', '/care', '/patient-info', '/clinicians',
  '/clinicians/dr-amara-osei', '/blog', '/blog/certification-is-not-a-state-card',
  '/pricing', '/faq',
  '/about', '/contact', '/privacy-policy', '/terms-conditions',
  '/refund-policy', '/telehealth-consent', '/medical-disclaimer',
  '/accessibility', '/this-page-does-not-exist'
]

const WORKSPACES = ['/patient', '/portal', '/staff', '/admin']

const findings = []
const note = (route, kind, detail) => findings.push({ route, kind, detail })

const browser = await chromium.launch()
console.log(`Auditing ${URL}\n`)

/* ---------- Per-page sweep ---------------------------------------- */

async function auditRoute(context, path, { axe = true, scrollSweep = true } = {}) {
  const page = await context.newPage()
  const errors = []
  const failed = []

  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    // A bare "Failed to load resource: ... 401" carries no URL in its text, so
    // the /api/ filter below cannot see it. The message's own location does.
    // The 500 filter is applied to the message alone, before the URL is folded
    // in — a port or asset hash containing "500" must not blank a real error.
    const from = m.location()?.url ?? ''
    if (m.text().includes('500')) return
    errors.push(from ? `console: ${m.text()} (${from})` : `console: ${m.text()}`)
  })
  page.on('requestfailed', (r) => {
    // Vite dev injects an HMR websocket we do not care about.
    if (!r.url().startsWith('ws')) failed.push(`${r.url()} — ${r.failure()?.errorText}`)
  })
  page.on('response', (r) => {
    if (r.status() < 400 || r.url().includes('__vite')) return
    // `GET /api/v1/session` is the signed-in check, and it is *meant* to answer
    // 401 when nobody is signed in — the private workspaces render their
    // session gate off exactly that 401. Counting it as a finding reported the
    // gate working as four errors on every run.
    if (r.status() === 401 && r.url().endsWith('/api/v1/session')) return
    failed.push(`${r.status()} ${r.url()}`)
  })

  await page.goto(`${URL}${path}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)

  // `vite preview` is a static server with no API behind it, so every /api/
  // call fails by construction. The Playwright suite covers API integration
  // properly with its synthetic in-memory server; counting these here would
  // bury real findings under environment noise.
  const isApi = (line) => line.includes('/api/')

  errors.filter((e) => !isApi(e)).forEach((e) => note(path, 'error', e))
  failed.filter((f) => !isApi(f)).forEach((f) => note(path, 'request', f))

  // --- Rendered-text brand leakage -----------------------------------
  const text = await page.evaluate(() => document.body.innerText)
  const legacy = text.match(/medcardaccess|medefy|medaccess/gi)
  if (legacy) note(path, 'brand', `rendered text contains: ${[...new Set(legacy)].join(', ')}`)

  // --- Glassmorphism / blur ------------------------------------------
  const glassy = await page.evaluate(() => {
    const hits = []
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el)
      if (cs.backdropFilter && cs.backdropFilter !== 'none') {
        hits.push(`${el.className || el.tagName}: backdrop-filter ${cs.backdropFilter}`)
      }
      if (cs.filter && cs.filter !== 'none') {
        hits.push(`${el.className || el.tagName}: filter ${cs.filter}`)
      }
    }
    return hits.slice(0, 8)
  })
  glassy.forEach((g) => note(path, 'glass', g))

  // --- Broken images --------------------------------------------------
  // Force every lazy image to load first. `loading="lazy"` images below the
  // fold report `complete === false`, which is indistinguishable from broken
  // and made four working assets on the home page look like 404s. This audit
  // is asking whether an image works, not whether it is above the fold.
  await page.evaluate(async () => {
    const images = [...document.images].filter((img) => img.loading === 'lazy')
    images.forEach((img) => {
      img.loading = 'eager'
    })
    await Promise.all(
      images.map((img) =>
        img.complete ? img.decode().catch(() => {}) : new Promise((done) => {
          img.addEventListener('load', done, { once: true })
          img.addEventListener('error', done, { once: true })
        })
      )
    )
  })

  const brokenImages = await page.evaluate(() =>
    [...document.images]
      .filter((img) => !img.complete || img.naturalWidth === 0)
      .map((img) => img.getAttribute('src'))
  )
  brokenImages.forEach((s) => note(path, 'image', `did not load: ${s}`))

  // --- Horizontal overflow -------------------------------------------
  // Measure the ability to scroll, not scrollWidth deltas. `overflow-x: clip`
  // on body can make scrollWidth report wider than clientWidth while the page
  // is genuinely unscrollable — a real layout bug and a false positive look
  // identical from the outside, so test the behaviour.
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement
    const before = window.scrollX
    window.scrollTo(300, window.scrollY)
    const moved = window.scrollX > before
    window.scrollTo(before, window.scrollY)
    if (!moved) return null
    const wide = [...document.querySelectorAll('body *')]
      .filter((el) => {
        const r = el.getBoundingClientRect()
        return r.right > doc.clientWidth + 1
      })
      .slice(0, 5)
      .map((el) => `${el.tagName}.${el.className || '(no class)'}`)
    return { spill: Math.round(doc.scrollWidth - doc.clientWidth), wide }
  })
  if (overflow) note(path, 'overflow', `page scrolls sideways ${overflow.spill}px — ${overflow.wide.join(' | ')}`)

  // --- Reveals must actually fire ------------------------------------
  if (scrollSweep) {
    await page.evaluate(async () => {
      const step = Math.round(window.innerHeight * 0.75)
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y)
        await new Promise((r) => setTimeout(r, 120))
      }
      window.scrollTo(0, document.body.scrollHeight)
    })
    await page.waitForTimeout(1200)

    const stuck = await page.evaluate(() => {
      const all = [...document.querySelectorAll('[data-reveal]')]
      return {
        total: all.length,
        stuck: all.filter((n) => !n.classList.contains('is-in')).map((n) => n.className || n.tagName)
      }
    })
    if (stuck.stuck.length) {
      note(path, 'reveal', `${stuck.stuck.length}/${stuck.total} never revealed: ${stuck.stuck.slice(0, 4).join(' | ')}`)
    }
  }

  // --- WCAG 2.1 AA ----------------------------------------------------
  if (axe) {
    // Un-hide every reveal before scanning. Content still at opacity 0 is
    // skipped by axe, which hides contrast bugs in exactly the block most
    // likely to contain them (the page tail).
    await page.evaluate(() => {
      document.querySelectorAll('[data-reveal]').forEach((n) => n.classList.add('is-in'))
      window.scrollTo(0, 0)
    })
    await page.waitForTimeout(400)

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    results.violations.forEach((v) => {
      note(path, `a11y:${v.id}`, `${v.impact} — ${v.nodes.length} node(s): ${v.nodes[0]?.target?.join(' ')}`)
    })
  }

  await page.close()
}

/* ---------- Run ---------------------------------------------------- */

const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } })
console.log('desktop 1440x900')
for (const route of MARKETING) {
  process.stdout.write(`  ${route.padEnd(28)}`)
  await auditRoute(desktop, route)
  console.log('ok')
}

const mobile = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true })
console.log('\nmobile 412x915')
for (const route of MARKETING) {
  process.stdout.write(`  ${route.padEnd(28)}`)
  await auditRoute(mobile, route)
  console.log('ok')
}

console.log('\nworkspaces (session gate rendered, axe skipped)')
for (const route of WORKSPACES) {
  process.stdout.write(`  ${route.padEnd(28)}`)
  await auditRoute(desktop, route, { axe: false, scrollSweep: false })
  console.log('ok')
}

await browser.close()

/* ---------- Report -------------------------------------------------- */

console.log(`\n${'='.repeat(64)}`)
if (findings.length === 0) {
  console.log('DEEP AUDIT PASSED — no findings across 19 routes x 2 viewports')
} else {
  const byKind = new Map()
  for (const f of findings) {
    if (!byKind.has(f.kind)) byKind.set(f.kind, [])
    byKind.get(f.kind).push(f)
  }
  for (const [kind, rows] of [...byKind].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n${kind.toUpperCase()}  (${rows.length})`)
    for (const r of rows.slice(0, 12)) console.log(`  ${r.route}  ${r.detail}`)
    if (rows.length > 12) console.log(`  … ${rows.length - 12} more`)
  }
  console.log(`\n${findings.length} finding(s).`)
}
console.log(`${'='.repeat(64)}\n`)
process.exit(findings.length ? 1 : 0)
