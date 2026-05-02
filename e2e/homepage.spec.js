import { test, expect } from '@playwright/test'

// The unauthenticated homepage renders LandingPage → HeroSection. Match the
// actual h1 ("Manage your GitHub repos…") rather than the legacy
// "Repo Manager" string that lived on an earlier landing design.
test.describe('Homepage', () => {
  test('should load the application', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /Manage your GitHub repos/i, level: 1 })).toBeVisible({ timeout: 15000 })
  })

  test('should display header with theme toggle', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /Manage your GitHub repos/i, level: 1 })).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('button', { name: /dark mode|light mode/i })).toBeVisible()
  })

  test('should be accessible with keyboard navigation', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /Manage your GitHub repos/i, level: 1 })).toBeVisible({ timeout: 15000 })

    await page.keyboard.press('Tab')
    const focusedElement = await page.evaluate(() => document.activeElement.tagName)
    expect(['A', 'BUTTON', 'INPUT']).toContain(focusedElement)
  })
})
