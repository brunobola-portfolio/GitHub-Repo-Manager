import { test, expect } from '@playwright/test'

test.describe('Migration Wizard', () => {
  test('opens via keyboard shortcut i', async ({ page }) => {
    await page.goto('/')
    await page.keyboard.press('i')
    await expect(page.getByRole('dialog')).toBeVisible()
  })
})
