import { test, expect } from '@playwright/test'

/**
 * Care-workspace browser tests.
 *
 * These run against the synthetic in-memory API from ../api/tests/browser-server.ts.
 * Workforce surfaces are signed in by planting the fixture session cookie, which
 * is exactly what the service issues — no credential is ever typed in, and no
 * real identity provider is contacted.
 */

const COOKIE_NAMES = {
  patient: 'mmjgreen-session',
  doctor: 'mmjgreen-session',
  staff: 'mmjgreen-session',
  admin: 'mmjgreen-session'
}

const TOKENS = {
  patient: 'p'.repeat(43),
  doctor: 'd'.repeat(43),
  staff: 's'.repeat(43),
  admin: 'a'.repeat(43)
}

/** Local origin is http, so the session cookie is not `__Host-` prefixed. */
async function signIn(page, role) {
  const context = page.context()
  await context.addCookies([
    {
      name: COOKIE_NAMES[role],
      value: TOKENS[role],
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax'
    }
  ])
}

function watchErrors(page) {
  const errors = []
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    // A 401 from the session probe is how a workspace learns it is signed
    // out; it is handled and the browser logs it regardless. Everything else
    // is a genuine fault.
    if (/401 \(Unauthorized\)/.test(m.text())) return
    errors.push(`console: ${m.text()}`)
  })
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  return errors
}

test.describe('Care workspaces', () => {
  test('patient workspace gates behind a session, then starts a guest intake', async ({ page }) => {
    const errors = watchErrors(page)
    await page.goto('/patient', { waitUntil: 'networkidle' })

    // Signed out: the guest entry is offered, not a blank screen.
    await expect(page.locator('.care__bar')).toBeVisible()
    await expect(page.getByRole('button', { name: /Start without an account/i })).toBeVisible()
    await expect(page.locator('body')).toContainText('MyFloraMD')

    await page.getByRole('button', { name: /Start without an account/i }).click()

    // Intake form loads from the API.
    await expect(page.getByRole('heading', { name: /Your care, in one place/i })).toBeVisible({
      timeout: 20_000
    })
    await expect(page.locator('input[name="firstName"]')).toBeVisible()
    await expect(page.locator('select[name="state"]')).toBeVisible()

    await page.screenshot({ path: 'artifacts/browser/care-patient-intake.png', fullPage: false })
    expect(errors).toEqual([])
  })

  test('patient intake questionnaire renders from the API', async ({ page }) => {
    await signIn(page, 'patient')
    await page.goto('/patient', { waitUntil: 'networkidle' })
    await expect(page.locator('input[name="firstName"]')).toBeVisible({ timeout: 20_000 })
    // The four questionnaire questions come from GET /api/v1/questionnaire.
    await expect(page.locator('textarea[name="goals"]')).toBeVisible()
    await expect(page.locator('textarea[name="history"]')).toBeVisible()
    await expect(page.locator('textarea[name="medications"]')).toBeVisible()
    await expect(page.locator('textarea[name="allergies"]')).toBeVisible()
    // Age gate is part of the validated answer allowlist.
    await expect(page.locator('input[name="age_verified"]')).toHaveCount(2)
  })

  test('clinician workspace loads assigned work', async ({ page }) => {
    const errors = watchErrors(page)
    await signIn(page, 'doctor')
    await page.goto('/portal', { waitUntil: 'networkidle' })

    await expect(page.getByRole('heading', { name: /Your day, with room for care/i })).toBeVisible({
      timeout: 20_000
    })
    await expect(page.locator('.care__card')).toHaveCount(3)
    await page.screenshot({ path: 'artifacts/browser/care-portal.png', fullPage: false })
    expect(errors).toEqual([])
  })

  test('staff workspace loads queues and detail', async ({ page }) => {
    const errors = watchErrors(page)
    await signIn(page, 'staff')
    await page.goto('/staff', { waitUntil: 'networkidle' })

    await expect(page.getByRole('heading', { name: /Every next step has a home/i })).toBeVisible({
      timeout: 20_000
    })
    await expect(page.locator('.switcher__btn')).toHaveCount(6)

    // Opening an intake must reach GET /api/v1/intakes/:id.
    const firstOpen = page.locator('.care__list .btn').first()
    if (await firstOpen.count()) {
      await firstOpen.click()
      await expect(page.locator('.care__card--detail')).toBeVisible({ timeout: 15_000 })
    }
    await page.screenshot({ path: 'artifacts/browser/care-staff.png', fullPage: false })
    expect(errors).toEqual([])
  })

  test('admin workspace loads access, delivery and audit panels', async ({ page }) => {
    const errors = watchErrors(page)
    await signIn(page, 'admin')
    await page.goto('/admin', { waitUntil: 'networkidle' })

    await expect(
      page.getByRole('heading', { name: /A considered view of every action/i })
    ).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('heading', { name: 'Access' })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Delivery readiness/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Recent activity/i })).toBeVisible()
    await page.screenshot({ path: 'artifacts/browser/care-admin.png', fullPage: false })
    expect(errors).toEqual([])
  })

  test('a signed-in patient cannot reach the admin workspace', async ({ page }) => {
    await signIn(page, 'patient')
    await page.goto('/admin', { waitUntil: 'networkidle' })
    // Wrong role means the workspace renders its own sign-in gate, not admin data.
    await expect(page.locator('.care__gate')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('heading', { name: /A considered view of every action/i })).toHaveCount(0)
  })

  test('private workspaces are marked noindex in the document', async ({ page }) => {
    for (const path of ['/patient', '/portal', '/staff', '/admin']) {
      await page.goto(path, { waitUntil: 'domcontentloaded' })
      // The X-Robots-Tag header is added by the service when it serves the
      // route. Under `vite preview` the bundle is served directly, so the
      // in-document tag is the guarantee that travels with the markup — and it
      // is the one that protects a CDN-fronted deployment.
      const robots = await page.locator('meta[name="robots"]').getAttribute('content')
      expect(robots, `${path} should be noindex`).toContain('noindex')
    }
  })

  test('signing out clears the session', async ({ page }) => {
    await signIn(page, 'doctor')
    await page.goto('/portal', { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { name: /Your day, with room for care/i })).toBeVisible({
      timeout: 20_000
    })
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page.locator('.care__gate')).toBeVisible({ timeout: 15_000 })
  })
})
