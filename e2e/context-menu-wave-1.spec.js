import { test, expect } from '@playwright/test'

test.describe('Wave 1 — Context menu items', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Auto-auth lands on Dashboard in mock mode; repo cards live in the
    // Repositories view. Navigate there before waiting for the card selector.
    await expect(page.getByRole('button', { name: 'Repositories' })).toBeVisible({ timeout: 15000 })
    await page.getByRole('button', { name: 'Repositories' }).click()
    await page.waitForSelector('[data-testid="repo-card"]', { timeout: 15000 })
  })

  test('Dry-Run opens MigrationWizard with dry-run pill visible', async ({ page }) => {
    const firstCard = page.locator('[data-testid="repo-card"]').first()
    await firstCard.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Migration', exact: true }).hover()
    await page.locator('text=Dry-Run (Simulate)').click()
    await expect(page.locator('[data-testid="migration-wizard"]')).toBeVisible()
    await expect(page.locator('[data-testid="dry-run-pill"]')).toBeVisible()
    await expect(page.locator('[data-testid="dry-run-pill"]')).toHaveText(/dry.?run/i)
  })

  test('Migration Risk Analysis is not shown in the context menu', async ({ page }) => {
    const firstCard = page.locator('[data-testid="repo-card"]').first()
    await firstCard.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'AI', exact: true }).hover()
    await expect(page.getByRole('menuitem', { name: 'Migration Risk Analysis', exact: true })).toHaveCount(0)
  })

  // Export goes through /api/v1/repos/:owner/:repo/export which proxies the
  // real GitHub API with the session token. In mock mode the session's
  // `mock_token` is rejected by GitHub, so no download fires. This test
  // requires a real OAuth session and is skipped in the default mock-mode
  // e2e suite.
  test.skip('Export Metadata triggers a JSON file download', async ({ page }) => {
    const firstCard = page.locator('[data-testid="repo-card"]').first()
    await firstCard.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Management', exact: true }).hover()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('menuitem', { name: 'Export Metadata (JSON)', exact: true }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/-export-\d+\.json$/)
  })

  test('Sync Repository is disabled for non-mirror repos', async ({ page }) => {
    const firstCard = page.locator('[data-testid="repo-card"]').first()
    await firstCard.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Management', exact: true }).hover()
    const syncItem = page.locator('[data-testid="menu-item-sync"]')
    await expect(syncItem).toHaveAttribute('aria-disabled', 'true')
  })
})
