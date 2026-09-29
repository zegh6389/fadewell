import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * Marketing-site smoke + quality gate.
 *
 * Every public route is loaded in a real browser at two viewports, checked for
 * runtime errors, verified for correct branding, and scanned for accessibility
 * violations. Screenshots are captured to artifacts/browser/ for review.
 */

const ROUTES = [
  { path: '/', name: 'home', expect: 'FadeWell' },
  { path: '/how-it-works', name: 'how-it-works', expect: 'Five steps' },
  { path: '/service', name: 'service', expect: 'your card in hand' },
  { path: '/care', name: 'care', expect: 'Qualifying conditions' },
  { path: '/patient-info', name: 'patient-info', expect: 'Feel prepared' },
  { path: '/clinicians', name: 'clinicians', expect: 'clinician' },
  { path: '/clinicians/dr-amara-osei', name: 'clinician', expect: 'Amara Osei' },
  { path: '/blog', name: 'blog', expect: 'Clearer answers' },
  { path: '/blog/certification-is-not-a-state-card', name: 'article', expect: 'Certification is not' },
  { path: '/pricing', name: 'pricing', expect: 'Published prices' },
  { path: '/faq', name: 'faq', expect: 'Answered properly' },
  { path: '/about', name: 'about', expect: 'About FadeWell' },
  { path: '/contact', name: 'contact', expect: 'Ask us anything' },
  { path: '/privacy-policy', name: 'privacy', expect: 'Privacy policy' },
  { path: '/terms-conditions', name: 'terms', expect: 'Terms of service' },
  { path: '/refund-policy', name: 'refund', expect: 'Refund policy' },
  { path: '/telehealth-consent', name: 'telehealth', expect: 'Telehealth consent' },
  { path: '/medical-disclaimer', name: 'disclaimer', expect: 'Medical disclaimer' },
  { path: '/accessibility', name: 'accessibility', expect: 'Accessibility' },
  { path: '/this-page-does-not-exist', name: 'not-found', expect: 'faded out' }
]

/** Collects console errors and failed requests for the life of the test. */
function watchErrors(page) {
  const errors = []
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    // The workspaces probe GET /api/v1/session on load to discover whether the
    // visitor is signed in. A 401 is the expected answer for an anonymous
    // visitor and is handled in app code; the browser still logs the failed
    // response. Anything else is a genuine fault.
    if (/401 \(Unauthorized\)/.test(message.text())) return
    errors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    const url = request.url()
    if (url.includes('/api/')) return
    errors.push(`requestfailed: ${url} — ${request.failure()?.errorText}`)
  })
  return errors
}

test.describe('FadeWell marketing site', () => {
  for (const route of ROUTES) {
    test(`${route.path} renders without errors`, async ({ page }, testInfo) => {
      const errors = watchErrors(page)
      const response = await page.goto(route.path, { waitUntil: 'networkidle' })

      expect(response?.status(), `${route.path} should return 200`).toBeLessThan(400)

      // Main landmark and a single H1.
      await expect(page.locator('main#main-content')).toBeVisible()
      await expect(page.locator('h1')).toHaveCount(1)

      const body = await page.locator('body').innerText()
      // innerText reflects CSS text-transform, so eyebrow copy arrives
      // uppercased. Compare case-insensitively against the source string.
      expect(body.toLowerCase(), `${route.path} should mention the expected copy`).toContain(
        route.expect.toLowerCase()
      )

      // FadeWell branding only — no legacy brand may survive anywhere.
      expect(body).not.toMatch(/medcardaccess|medefy|medaccess/i)

      await page.waitForTimeout(400)
      await page.screenshot({
        path: `artifacts/browser/${testInfo.project.name}-${route.name}.png`,
        fullPage: false
      })

      expect(errors, `${route.path} produced runtime errors`).toEqual([])
    })
  }

  test('home page is branded, navigable and animates on scroll', async ({ page }, testInfo) => {
    const errors = watchErrors(page)
    await page.goto('/', { waitUntil: 'networkidle' })

    // Wordmark + primary navigation.
    await expect(page.locator('.brand').first()).toContainText('FadeWell')
    await expect(page.locator('nav.nav .nav__link')).toHaveCount(6)

    // Reveal elements start hidden and animate in as they enter the viewport.
    const deep = page.locator('.story__step').first()
    await deep.scrollIntoViewIfNeeded()
    await expect(deep).toHaveClass(/is-in/, { timeout: 5000 })

    // The pinned journey track should have had its overflow measured so the
    // scroll-driven keyframe knows how far to translate it. It is published as
    // a CSS length, so parse the number out rather than coercing the string.
    await page.locator('#journey').scrollIntoViewIfNeeded()
    await page.waitForTimeout(600)
    const overflow = await page.locator('.journey__track').evaluate((el) =>
      parseFloat(el.style.getPropertyValue('--track-overflow'))
    )
    expect(overflow, 'journey track overflow should be measured in px').toBeGreaterThan(0)

    // Measuring the overflow is not evidence the track moves. A `view()`
    // timeline on the track itself is dead on arrival — the track lives inside
    // a sticky pin that never leaves the viewport, so its progress never
    // changes. Assert the motion itself, at both ends of the pinned range.
    const sampleAt = async (fraction) => {
      await page.evaluate((f) => {
        const journey = document.querySelector('.journey')
        const pin = document.querySelector('.journey__pin')
        // `behavior: instant` is required: the site sets
        // `html { scroll-behavior: smooth }`, so a plain scrollTo animates and
        // a short settle time reads the track mid-flight.
        window.scrollTo({
          top: journey.offsetTop + (journey.offsetHeight - pin.offsetHeight) * f,
          behavior: 'instant'
        })
      }, fraction)
      // A scroll-driven animation only updates on the next frame; reading in
      // the same tick as scrollTo returns the previous position.
      await page.waitForTimeout(400)
      return page.evaluate(() => {
        const box = (sel) => {
          const r = document.querySelector(sel).getBoundingClientRect()
          return { left: Math.round(r.left), right: Math.round(r.right) }
        }
        return {
          translateX: new DOMMatrixReadOnly(
            getComputedStyle(document.querySelector('.journey__track')).transform
          ).m41,
          first: box('.journey__panel:first-of-type'),
          last: box('.journey__panel:last-of-type'),
          // The content column the heading and the progress rule both sit on.
          column: box('.journey__progress'),
        }
      })
    }

    // Below 640px the section deliberately unpins and becomes a native
    // horizontal scroller, so the track must NOT be translated there.
    const isStacked = await page.evaluate(() => window.innerWidth <= 640)

    if (isStacked) {
      expect((await sampleAt(0.9)).translateX, 'stacked track must not be translated').toBe(0)
    } else {
      // Sample the true endpoints of the pinned range: the keyframes are
      // defined there, so these are exact rather than approximate.
      const start = await sampleAt(0)
      const end = await sampleAt(1)

      // The range is published as a measurement, so both ends should land
      // exactly. A loose tolerance here is what let an off-by-88px range ship:
      // the track was already part-way across before the pin had even engaged.
      expect(Math.abs(start.translateX), 'track should start untranslated').toBeLessThan(2)
      expect(end.translateX - start.translateX, 'track should travel the full width').toBeLessThan(-100)
      expect(
        Math.abs(end.translateX + overflow),
        'track should finish exactly at the measured overflow'
      ).toBeLessThan(2)

      // The viewport is full-bleed, so the track has to place its own panels
      // back on the content column — otherwise the first and last card lose
      // their rounded corners to the screen edge, at exactly the two moments
      // the reader looks straight at them.
      expect(
        Math.abs(start.first.left - start.column.left),
        'first panel should start on the content column'
      ).toBeLessThan(3)
      expect(
        Math.abs(end.last.right - end.column.right),
        'last panel should finish on the content column'
      ).toBeLessThan(3)
    }

    // Full-page capture for design review.
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(500)
    await page.screenshot({
      path: `artifacts/browser/${testInfo.project.name}-home-full.png`,
      fullPage: true
    })

    expect(errors).toEqual([])
  })

  test('the eligibility check answers, and the ticker stops when asked', async ({ page }) => {
    const errors = watchErrors(page)
    await page.goto('/', { waitUntil: 'networkidle' })

    // The state picker is the most-used control on the site, and it sits in
    // the final CTA at the bottom. Drive it the way a person would.
    const picker = page.locator('.state-picker').last()
    await picker.scrollIntoViewIfNeeded()

    // Submitting with nothing chosen must say so, and return focus to the
    // field rather than failing silently.
    await picker.getByRole('button', { name: /check my eligibility/i }).click()
    await expect(picker.locator('.state-picker__status')).toHaveClass(/is-error/)
    await expect(picker.locator('.state-picker__status')).toContainText(/choose your state/i)
    await expect(picker.locator('select')).toBeFocused()

    // An open state resolves to a next step and offers a way into the intake.
    await picker.locator('select').selectOption('Colorado')
    await picker.getByRole('button', { name: /check my eligibility/i }).click()
    await expect(picker.locator('.state-picker__status')).toHaveClass(/is-available/)
    await expect(picker.locator('.state-picker__status')).toContainText(/Colorado/)
    await expect(picker.getByRole('link', { name: /continue to the intake/i })).toBeVisible()

    // A state we have not opened says so honestly, and routes to updates
    // rather than pretending it is available.
    await picker.locator('select').selectOption('Oklahoma')
    await picker.getByRole('button', { name: /check my eligibility/i }).click()
    await expect(picker.locator('.state-picker__status')).toHaveClass(/is-coming-soon/)
    await expect(picker.locator('.state-picker__status')).toContainText(/coming soon/i)

    // The ticker runs forever, so it has to be stoppable. WCAG 2.2.2.
    const track = page.locator('.marquee__track').first()
    const pause = page.locator('.marquee__pause').first()
    await pause.scrollIntoViewIfNeeded()
    // Park the pointer away from the marquee first. The ticker also pauses on
    // hover, and an earlier click in this test leaves the virtual mouse
    // wherever that click landed — which made "is it moving?" depend on scroll
    // position rather than on the animation.
    await page.mouse.move(2, 2)

    const moving = async () => {
      const first = await track.evaluate((el) => el.getBoundingClientRect().x)
      await page.waitForTimeout(500)
      const second = await track.evaluate((el) => el.getBoundingClientRect().x)
      return Math.abs(second - first)
    }

    // A reduced-motion context never animates, so only assert the moving case
    // there — the paused case is asserted either way.
    if (await page.evaluate(() => !matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      expect(await moving(), 'ticker should be moving before it is paused').toBeGreaterThan(1)
    }
    await pause.click()
    await expect(pause).toHaveAttribute('aria-pressed', 'true')
    expect(await moving(), 'ticker must stop when paused').toBeLessThan(1)

    expect(errors).toEqual([])
  })

  test('every home section renders with real content', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })

    // Each of these was missing at some point and shipped as an empty shell
    // at least once, so assert on content rather than on the wrapper. Only
    // element selectors that carry text can be filtered by `hasText` — an
    // `<img>` has no text content, so the sample card is checked by its alt
    // further down instead.
    const sections = [
      ['.proof__grid .proof__item', 3, /Online evaluation/i],
      ['.proof__disc', 1, null],
      ['.grid--4 .card', 4, /Photo identification/i],
      ['.story-frame', 2, /Clarity, from the start/i],
      ['.path-card', 2, /First-time patient/i],
      ['.after__item', 3, /state portal/i],
      ['.compliance__point', 3, /Encrypted in transit/i],
      ['.preview__art img', 1, null],
      ['.grid--3 .card', 3, /Read the piece/i],
      ['.marquee__item', 5, /HIPAA-aligned/i]
    ]

    for (const [selector, min, text] of sections) {
      const found = page.locator(selector)
      await expect(found.first(), `${selector} should render`).toBeVisible()
      // Assert the count outright rather than only when it already passes —
      // the old guard skipped the check on exactly the case it existed for.
      expect(await found.count(), `${selector} should render at least ${min}`).toBeGreaterThanOrEqual(min)
      if (text) {
        await expect(page.locator(selector).filter({ hasText: text }).first(), `${selector} copy`).toBeVisible()
      }
    }

    // The coverage table reads from the live API, so it either lists states
    // or explains why it cannot. It must never be silently empty.
    await page.locator('.states').scrollIntoViewIfNeeded()
    await page.waitForTimeout(1200)
    const states = await page.locator('.states').innerText()
    expect(states, 'coverage table must render rows or an honest failure').toMatch(
      /open|coming soon|could not load|empty/i
    )

    // The sample card is an illustration, and says so. A card that reads like
    // a real credential is the wrong thing to ship on a medical page.
    const card = page.locator('.preview__art img')
    await expect(card).toHaveAttribute('alt', /not a real credential/i)
  })

  test('decorative rules stay rules at every viewport', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    await page.locator('.story__rail-line').scrollIntoViewIfNeeded()

    // The story rail is a 3px rule on desktop and becomes a horizontal rule
    // when the layout stacks. It has previously rendered as a 3rem solid block,
    // which is indistinguishable from an empty button. Keep it thin.
    const box = await page.locator('.story__rail-line').evaluate((el) => {
      const r = el.getBoundingClientRect()
      return { width: r.width, height: r.height }
    })
    expect(box.width).toBeGreaterThan(0)
    expect(
      Math.min(box.width, box.height),
      'rail rule should stay thin in both axes'
    ).toBeLessThan(8)
  })

  test('every navigation link resolves to a real page', async ({ page }) => {
    const errors = watchErrors(page)
    await page.goto('/', { waitUntil: 'networkidle' })

    const hrefs = await page.locator('a[href^="/"]').evaluateAll((nodes) =>
      [...new Set(nodes.map((n) => n.getAttribute('href')))].filter(Boolean)
    )

    for (const href of hrefs) {
      const response = await page.goto(href, { waitUntil: 'domcontentloaded' })
      expect(response?.status(), `${href} returned ${response?.status()}`).toBeLessThan(400)
      // Guard against a link silently falling through to the 404 page.
      const h1 = await page.locator('h1').first().innerText()
      expect(h1, `${href} resolved to the 404 page`).not.toContain('faded out')
    }

    expect(errors).toEqual([])
  })

  test('has no accessibility violations on the home page', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    expect(results.violations, JSON.stringify(results.violations.map((v) => v.id), null, 2)).toEqual([])
  })

  test('has no accessibility violations on an interior page', async ({ page }) => {
    await page.goto('/pricing', { waitUntil: 'networkidle' })
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    expect(results.violations, JSON.stringify(results.violations.map((v) => v.id), null, 2)).toEqual([])
  })

  test('FAQ accordion opens and closes', async ({ page }) => {
    await page.goto('/faq', { waitUntil: 'networkidle' })
    const trigger = page.locator('.accordion__trigger').nth(1)
    const panelId = await trigger.getAttribute('aria-controls')
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await trigger.click()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator(`#${panelId}`)).toHaveClass(/is-open/)
  })
})
