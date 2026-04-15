import { test, expect } from '@playwright/test'

test.describe('Homepage', () => {
  test('should load the application', async ({ page }) => {
    await page.goto('/')

    // Check if the main heading is visible
    await expect(page.getByRole('heading', { name: /Repo Manager/i })).toBeVisible({ timeout: 15000 })
  })

  test('should display header with theme toggle', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /Repo Manager/i })).toBeVisible({ timeout: 15000 })

    // Check for theme toggle button (aria-label is "Dark mode" or "Light mode")
    await expect(page.getByRole('button', { name: /dark mode|light mode/i })).toBeVisible()
  })

  test('should be accessible with keyboard navigation', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /Repo Manager/i })).toBeVisible({ timeout: 15000 })

    // Tab through interactive elements
    await page.keyboard.press('Tab')

    // First interactive element should receive focus
    const focusedElement = await page.evaluate(() => document.activeElement.tagName)
    expect(['A', 'BUTTON', 'INPUT']).toContain(focusedElement)
  })
})
