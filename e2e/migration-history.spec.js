import { test, expect } from '@playwright/test'

test.describe('Migration History', () => {
  test('can view migration history', async ({ page }) => {
    await page.goto('/')
    // Basic test that the page loads
    await expect(page).toHaveTitle(/.+/)
  })
})
