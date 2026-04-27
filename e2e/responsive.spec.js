import { test, expect } from '@playwright/test'

// Use mobile viewport at file level
test.use({ viewport: { width: 390, height: 844 }, isMobile: true })

test.describe('Mobile Responsiveness', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // The mobile header doesn't render the "Repo Manager" text heading (only
    // an icon img). Use the auto-authenticated avatar as the ready signal —
    // present as soon as useGitHub finishes mock auth.
    await expect(page.getByAltText('dev-user')).toBeVisible({ timeout: 15000 })
  })

  test('should show mobile navigation buttons', async ({ page }) => {
    await expect(page.getByRole('button', { name: /dashboard/i }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Repos', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Teams' })).toBeVisible()
  })

  test('should show floating menu button on mobile', async ({ page }) => {
    const menuButton = page.getByLabel('Open navigation menu')
    await expect(menuButton).toBeVisible()
  })

  test('should open mobile drawer when clicking menu button', async ({ page }) => {
    const menuButton = page.getByLabel('Open navigation menu')
    // Use force click because dashboard gradient overlay may intercept pointer events
    await menuButton.click({ force: true })

    // Drawer is a role=dialog with aria-label "Navigation drawer"; assert on
    // that rather than on Sidebar content text (which can race the spring
    // animation in CI and gives a flaky 5s window).
    await expect(page.getByRole('dialog', { name: /navigation drawer/i }))
      .toBeVisible({ timeout: 5000 })
  })

  test('should navigate to repos view on mobile', async ({ page }) => {
    // Click the Repos tab using exact name matching
    await page.getByRole('button', { name: 'Repos', exact: true }).click()

    // Wait for repos to load - use longer timeout for mobile
    await expect(page.getByPlaceholder(/search repositories/i)).toBeVisible({ timeout: 15000 })
  })

  test('should show theme toggle on mobile', async ({ page }) => {
    const themeButton = page.getByRole('button', { name: /dark mode|light mode|switch to dark|switch to light/i })
    await expect(themeButton).toBeVisible()
  })

  test('should show user avatar on mobile', async ({ page }) => {
    await expect(page.getByAltText('dev-user')).toBeVisible()
  })

  test('should show dashboard content on mobile', async ({ page }) => {
    // Ensure we're on the Dashboard view — on some mobile boot paths the
    // default view can race against lazy imports.
    const dashNav = page.getByRole('button', { name: /dashboard/i }).first()
    if (await dashNav.isVisible({ timeout: 5000 }).catch(() => false)) {
      await dashNav.click().catch(() => {})
    }
    await expect(page.getByText('Total Repositories')).toBeVisible({ timeout: 15000 })
    // Use exact heading match — the dashboard also renders "12 487" (stars)
    // which contains '87' as substring and triggers a strict-mode violation.
    await expect(page.getByRole('heading', { name: '87', exact: true })).toBeVisible({ timeout: 5000 })
  })
})
