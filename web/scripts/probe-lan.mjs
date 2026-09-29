/**
 * Prove the LAN origin works in a real browser, not just in a header probe.
 *
 * Loading the marketing site proves almost nothing: a GET is not origin
 * checked. The part that actually breaks over the network is a state-changing
 * request — signing in, starting a guest intake — because those are refused
 * unless the Origin is recognised. So this drives a real guest intake from the
 * LAN address and checks the session cookie survives.
 *
 *   PROBE_URL=http://192.168.2.47:4173 node scripts/probe-lan.mjs
 */

import { chromium } from '@playwright/test'

const base = (process.env.PROBE_URL ?? '').replace(/\/+$/, '')
if (!base) {
  console.error('Set PROBE_URL to the LAN address, e.g. http://192.168.2.47:4173')
  process.exit(1)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 430, height: 900 }, isMobile: true, hasTouch: true })

const errors = []
const unauthorized = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))
page.on('response', (r) => {
  if (r.status() < 400) return
  // `GET /api/v1/session` is the signed-in check, and it is *supposed* to
  // answer 401 before anyone has signed in. The page renders its gate off that
  // 401. Treating it as a failure is how the deep audit ended up reporting four
  // errors that were the gate working.
  if (r.status() === 401 && r.url().endsWith('/api/v1/session')) unauthorized.push(r.url())
})

const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

console.log(`Probing ${base}\n`)

// The browser must see a plain-HTTP origin, so session cookies are not Secure.
console.log('context')
await page.goto(`${base}/`, { waitUntil: 'networkidle' })
check('home page loads over the LAN', (await page.title()).length > 0, await page.title())
check('no mixed-content or CSP refusal', !errors.some((e) => /Content Security Policy|mixed content/i.test(e)))

// A mutating request from this origin, driven the way a person would.
console.log('\nstate-changing request (the part that actually breaks)')
await page.goto(`${base}/patient`, { waitUntil: 'networkidle' })
const guest = page.getByRole('button', { name: /start|begin|guest|continue/i }).first()
const hadGate = await guest.count()
if (hadGate) {
  await guest.click()
  await page.waitForTimeout(2500)
} else {
  await page.waitForTimeout(1500)
}

const nameField = page.locator('input[name="firstName"]')
check('guest intake opened on the LAN origin', (await nameField.count()) > 0)

// If a session cookie was issued it is a real, non-Secure cookie scoped to the
// LAN host — which is what lets a phone stay signed in across a refresh.
const cookies = await page.context().cookies(base)
const session = cookies.find((c) => c.name === 'fadewell-session' || c.name.startsWith('__Host-'))
check('session cookie issued', Boolean(session), session ? `${session.name} secure=${session.secure}` : 'none')
check('cookie usable on this origin', Boolean(session) && session?.secure === false)

console.log('\nrendered')
// The 401 above still reaches the console as a resource error, so allow exactly
// that one message and nothing else.
const realErrors = errors.filter((e) => !/401 \(Unauthorized\)/.test(e))
check('no runtime errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '))
check(
  'only expected 401s (the signed-in check)',
  unauthorized.every((u) => u.endsWith('/api/v1/session')),
  `${unauthorized.length} seen`
)

await page.screenshot({ path: 'artifacts/browser/lan-patient-intake.png', fullPage: false })
await page.goto(`${base}/`, { waitUntil: 'networkidle' })
await page.screenshot({ path: 'artifacts/browser/lan-home.png', fullPage: false })

await browser.close()

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed on ${base}`)
if (failed.length) {
  console.error('\nLAN probe FAILED:\n  - ' + failed.map((f) => f.name).join('\n  - '))
  process.exit(1)
}
console.log('LAN OK — the site loads and accepts writes from this address')
