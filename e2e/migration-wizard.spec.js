import { test, expect } from '@playwright/test'

test.describe('Migration Wizard', () => {
  test('opens via keyboard shortcut i', async ({ page }) => {
    await page.goto('/')
    // Wait for the authenticated app to mount — keyboard shortcuts are only
    // registered once the main view is active (not on landing/login).
    await expect(page.getByRole('button', { name: 'Repositories' })).toBeVisible({ timeout: 15000 })
    await page.keyboard.press('i')
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 })
  })
})
