import { test, expect } from '@playwright/test'

// NOTE: These tests assume the dev server is running separately
// (e.g. `VITE_MOCK_MODE=true npm run dev`) and that the mock user
// is signed in so the Repositories view and data are available.

const gotoRepos = async (page: import('@playwright/test').Page) => {
  await page.goto('/')
  const reposNav = page.getByRole('button', { name: 'Repositories' })
  if (await reposNav.isVisible()) {
    await reposNav.click()
  }
}

test.describe('context menus', () => {
  test('repo actions menu positions correctly and supports dark mode', async ({ page }) => {
    await gotoRepos(page)

    const rows = page.locator('table tbody tr')
    const rowCount = await rows.count()
    expect(rowCount).toBeGreaterThan(0)

    // Open the menu on the last visible row to stress bottom-of-viewport positioning
    const lastRow = rows.nth(rowCount - 1)
    await lastRow.hover()
    await lastRow.getByTitle('More actions').click()

    const menu = page.getByTestId('repo-actions-menu')
    await expect(menu).toBeVisible()

    // Ensure the menu is fully within the viewport
    const box = await menu.boundingBox()
    expect(box).not.toBeNull()
    if (box) {
      const viewport = page.viewportSize()!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
    }

    // Toggle dark mode via the theme toggle button in the header
    await page.getByRole('button', { name: /dark mode|light mode/i }).click()

    // Menu should still be visible and adopt dark background color
    await expect(menu).toBeVisible()
    const bg = await menu.evaluate((el) => getComputedStyle(el as HTMLElement).backgroundColor)
    // In dark mode we expect a non-white background (e.g. slate-800)
    expect(bg).not.toBe('rgb(255, 255, 255)')
  })

  test('org quick menu uses overlay and is not clipped', async ({ page }) => {
    await gotoRepos(page)

    // Open org quick menu on the last org in the list (near bottom of scroll)
    const orgCards = page.locator('[data-testid="org-card"]')
    const orgCount = await orgCards.count()
    expect(orgCount).toBeGreaterThan(0)

    const lastOrg = orgCards.nth(orgCount - 1)
    await lastOrg.hover()
    await lastOrg.getByTitle('More actions').click()

    const menu = page.getByTestId('org-actions-menu')
    await expect(menu).toBeVisible()

    const box = await menu.boundingBox()
    expect(box).not.toBeNull()
    if (box) {
      const viewport = page.viewportSize()!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
    }
  })
})

