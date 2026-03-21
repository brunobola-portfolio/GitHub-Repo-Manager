import { test, expect } from '@playwright/test'

test.describe('Context Menu', () => {
  test('opens on right-click', async ({ page }) => {
    await page.goto('/')
    // Right-click on first repo card
    const card = page.locator('[data-testid="repo-card"]').first()
    if (await card.isVisible()) {
      await card.click({ button: 'right' })
      await expect(page.getByRole('menu')).toBeVisible()
    }
  })
})
