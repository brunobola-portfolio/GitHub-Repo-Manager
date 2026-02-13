import { test, expect } from '@playwright/test'

test.describe('Homepage', () => {
  test('should load the application', async ({ page }) => {
    await page.goto('/')

    // Check if the main heading is visible
    await expect(page.getByRole('heading', { name: 'GitHub Repo Manager' })).toBeVisible()
  })

  test('should display header navigation', async ({ page }) => {
    await page.goto('/')

    // Check for theme toggle button
    await expect(page.getByRole('button', { name: /theme/i })).toBeVisible()
  })

  test('should be accessible with keyboard navigation', async ({ page }) => {
    await page.goto('/')

    // Tab through interactive elements
    await page.keyboard.press('Tab')

    // First interactive element should receive focus
    const focusedElement = await page.evaluate(() => document.activeElement.tagName)
    expect(['A', 'BUTTON', 'INPUT']).toContain(focusedElement)
  })
})
