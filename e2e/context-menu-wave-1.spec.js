import { test, expect } from '@playwright/test'

test.describe('Wave 1 — Context menu items', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=1')
    await page.waitForSelector('[data-testid="repo-card"]')
  })

  test('Dry-Run opens MigrationWizard with dry-run pill visible', async ({ page }) => {
    const firstCard = page.locator('[data-testid="repo-card"]').first()
    await firstCard.click({ button: 'right' })
    await page.locator('text=Migration').hover()
    await page.locator('text=Dry-Run (Simulate)').click()
    await expect(page.locator('[data-testid="migration-wizard"]')).toBeVisible()
    await expect(page.locator('[data-testid="dry-run-pill"]')).toBeVisible()
    await expect(page.locator('[data-testid="dry-run-pill"]')).toHaveText(/dry.?run/i)
  })
})
