import { test, expect } from '@playwright/test'

const routes = ['/', '/how-it-works', '/service', '/care', '/patient-info', '/clinicians', '/clinicians/dr-amara-osei', '/blog', '/blog/certification-is-not-a-state-card', '/pricing', '/faq', '/about', '/contact', '/privacy-policy', '/terms-conditions', '/refund-policy', '/telehealth-consent', '/medical-disclaimer', '/accessibility', '/missing-page']

for (const width of [320, 390, 768]) {
  test(`public layouts fit ${width}px before and after scrolling`, async ({ page }) => {
    test.setTimeout(120000)
    await page.setViewportSize({ width, height: 844 })
    const failures = []
    for (const path of routes) {
      await page.goto(path)
      await page.locator('h1').waitFor()
      await page.waitForTimeout(1000)
      const findings = await page.evaluate(async () => {
        const errors = []
        const header = document.querySelector('.masthead').getBoundingClientRect()
        const brand = document.querySelector('.masthead .brand').getBoundingClientRect()
        const actions = document.querySelector('.masthead__actions').getBoundingClientRect()
        if (brand.right > actions.left) errors.push('Header brand overlaps actions')
        for (const el of document.querySelectorAll('.masthead__inner .brand, .masthead__actions > *')) {
          if (!el.getClientRects().length) continue
          const r = el.getBoundingClientRect()
          if (r.left < header.left || r.right > header.right || r.top < header.top || r.bottom > header.bottom) errors.push(`Header spills: ${el.className}`)
        }
        for (const el of document.querySelectorAll('[data-reveal]')) {
          if (!el.getClientRects().length || el.closest('dialog')) continue
          el.scrollIntoView({ behavior: 'instant', block: 'center' })
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          // IntersectionObserver delivery may trail layout/image reflow by a frame.
          for (let attempt = 0; attempt < 6 && !el.classList.contains('is-in'); attempt += 1) {
            await new Promise(resolve => setTimeout(resolve, 25))
          }
          if (!el.classList.contains('is-in')) errors.push(`Reveal stuck: ${el.className}`)
        }
        // Off-screen entrance transforms are intentional. Measure final layout,
        // after each reveal has actually entered and finished its transition.
        await new Promise(resolve => setTimeout(resolve, 1000))
        for (const el of document.querySelectorAll('main h1, main h2, main h3, main input, main select, main textarea, main .btn, main .card, main .plan')) {
          if (!el.getClientRects().length || el.closest('.journey__viewport, dialog')) continue
          const r = el.getBoundingClientRect()
          if (r.left < -1 || r.right > innerWidth + 1) errors.push(`Content spills: ${el.className} (${Math.round(r.left)}, ${Math.round(r.right)})`)
          if (el.matches('input, select, textarea') && parseFloat(getComputedStyle(el).fontSize) < 16) errors.push(`Small input triggers mobile zoom: ${el.className}`)
        }
        if (document.documentElement.scrollWidth > innerWidth + 1) errors.push('Document overflows horizontally')
        return [...new Set(errors)]
      })
      if (findings.length) failures.push({ path, findings })
    }
    expect(failures).toEqual([])
  })
}

test('mobile menu remains within viewport and chat input avoids focus zoom', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open menu' }).click()
  const sheet = page.locator('#nav-sheet')
  await expect(sheet).toBeVisible()
  const box = await sheet.boundingBox()
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(320)
  expect(box.y + box.height).toBeLessThanOrEqual(568)
  await page.getByRole('button', { name: 'Close menu' }).click()
  await page.getByRole('button', { name: 'Need help?' }).click()
  await expect(page.getByRole('textbox', { name: 'Your message' })).toHaveCSS('font-size', '16px')
  await page.getByRole('button', { name: 'Close help' }).click()
  await page.getByRole('button', { name: 'Open menu' }).click()
  await page.setViewportSize({ width: 1024, height: 768 })
  await expect(sheet).not.toBeVisible()
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden')
})

test('touch layouts keep words separated and disable hover-only media motion', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const header = page.locator('.masthead__inner')
  await expect(header).toHaveCSS('height', '64px')
  await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible()
  await expect(page.locator('.hero__intro .lede')).toHaveCSS('opacity', '1')
  await expect(page.locator('.hero .reveal-line > span').last()).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)')
  await page.screenshot({ path: 'artifacts/browser/mobile-header-top.png' })
  const preview = page.locator('.preview__art .medical-card')
  await preview.scrollIntoViewIfNeeded()
  await expect(preview).toHaveCSS('transform', 'none')
  for (const line of await page.locator('.word-reveal__line').all()) {
    expect(await line.evaluate(el => el.textContent.trim())).toBe(await line.locator('.word-reveal__word').allTextContents().then(words => words.join(' ')))
  }
  await expect(page.locator('.drift').first()).toHaveCSS('animation-name', 'none')
  await expect(header).toHaveCSS('height', '64px')
  await expect(page.locator('.preview__art')).toHaveCSS('opacity', '1')
  await page.screenshot({ path: 'artifacts/browser/mobile-header-scrolled.png' })
  await page.setViewportSize({ width: 768, height: 844 })
  await expect(page.locator('.journey__track')).toHaveCSS('animation-name', 'none')
  await expect(page.locator('.journey__viewport')).toHaveCSS('overflow-x', 'auto')
})
