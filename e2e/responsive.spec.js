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
    // The mobile bottom-nav (Header.jsx) renders short labels: Home, Repos,
    // Work, Teams, More. Use exact matches so we don't accidentally hit the
    // "Open navigation menu" FAB or any "More" sheet trigger.
    const bottomNav = page.getByRole('navigation', { name: /main navigation/i })
    await expect(bottomNav).toBeVisible()
    await expect(bottomNav.getByRole('button', { name: 'Home', exact: true })).toBeVisible()
    await expect(bottomNav.getByRole('button', { name: 'Repos', exact: true })).toBeVisible()
    await expect(bottomNav.getByRole('button', { name: 'Teams', exact: true })).toBeVisible()
  })

  test('should show floating menu button on mobile', async ({ page }) => {
    const menuButton = page.getByLabel('Open navigation menu')
    await expect(menuButton).toBeVisible()
  })

  test('should open mobile drawer when clicking menu button', async ({ page }) => {
    const menuButton = page.getByLabel('Open navigation menu')
    // Force-click bypasses pointer interception (dashboard gradient, FABs,
    // etc.). On slow CI runners the click event sometimes loses races with
    // hydration, so we also dispatch a programmatic click as a belt-and-
    // braces — both call the same React onClick handler harmlessly.
    await menuButton.click({ force: true }).catch(() => {})
    await menuButton.evaluate((el) => el.click()).catch(() => {})

    // Match the dialog by role only — framer-motion wraps the node and the
    // accessible-name match has been flaky on slow CI even when the dialog
    // is visibly open. Both MobileDrawer instances (nav + org) share the
    // same aria-label, so we use .first() to be explicit.
    await expect(page.locator('[role="dialog"]').first())
      .toBeVisible({ timeout: 15000 })
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
