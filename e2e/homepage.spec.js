import { test, expect } from '@playwright/test'

// Mock-mode (the e2e default per .env.test + playwright.config webServer env)
// auto-logs the dev-user in, so the homepage renders the authenticated layout
// — the brand <h2>Repo Manager</h2> in Header.jsx. The legacy "Manage your
// GitHub repos" h1 only appears on the LandingPage which is unreachable in
// mock-mode.
test.describe('Homepage', () => {
  test('should load the application', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /Repo Manager/i })).toBeVisible({ timeout: 15000 })
  })

  test('should display header with theme toggle', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /Repo Manager/i })).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('button', { name: /dark mode|light mode/i })).toBeVisible()
  })

  test('should be accessible with keyboard navigation', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /Repo Manager/i })).toBeVisible({ timeout: 15000 })

    await page.keyboard.press('Tab')
    const focusedElement = await page.evaluate(() => document.activeElement.tagName)
    expect(['A', 'BUTTON', 'INPUT']).toContain(focusedElement)
  })
})
