import { test, expect } from '@playwright/test'

test('premium assets, typewriter, hover and 3D interaction work', async ({ page }, testInfo) => {
  await page.goto('/')
  const scene = page.locator('.telehealth-scene')
  await scene.scrollIntoViewIfNeeded()
  for (const selector of ['.doctor-window > img', '.botanical-disc img', '.scene-card img']) {
    await expect.poll(() => page.locator(selector).evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true)
  }
  await expect(page.locator('.hero-typewriter span')).toHaveCSS('clip-path', /^inset\(0px(?: 0% 0px 0px)?\)$/)
  await expect(page.locator('.scene-card img')).toHaveAttribute('alt', /Not a real credential/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  if (testInfo.project.name === 'desktop') {
    const box = await scene.boundingBox()
    await page.mouse.move(box.x + box.width * .8, box.y + box.height * .25)
    await expect.poll(() => scene.evaluate(el => parseFloat(el.style.getPropertyValue('--scene-y')))).not.toBe(0)
    await page.mouse.move(1, 1)
    await expect.poll(() => scene.evaluate(el => el.style.getPropertyValue('--scene-y'))).toBe('0deg')
    const cta = page.locator('.hero__actions .btn--primary')
    await cta.hover()
    await expect(cta).toHaveCSS('background-color', 'rgb(23, 74, 50)')
    await expect(cta).toHaveCSS('color', 'rgb(255, 255, 255)')
  }
})

test('client-side route changes initialize new scroll reveals', async ({ page }) => {
  await page.goto('/')
  const pricing = page.locator('.footer__links a[href="/pricing"]').first()
  await pricing.click()
  await expect(page).toHaveURL(/\/pricing$/)
  const target = page.locator('[data-reveal]').first()
  await target.scrollIntoViewIfNeeded()
  await expect(target).toHaveClass(/is-in/)
  await page.locator('.brand').first().click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.locator('.hero__visual')).toHaveClass(/is-in/)
})

test('reduced motion preserves copy and disables pointer tilt', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.locator('.hero-typewriter span')).toHaveCSS('animation-name', 'none')
  await expect(page.locator('.hero-typewriter span')).toHaveCSS('clip-path', 'none')
  await expect(page.locator('.scene-depth')).toHaveCSS('transform', 'none')
  await expect(page.locator('.scene-card')).toHaveCSS('animation-name', 'none')
})
