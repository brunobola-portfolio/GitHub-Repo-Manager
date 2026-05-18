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
    // Quick actions FAB or any "More" sheet trigger.
    const bottomNav = page.getByRole('navigation', { name: /main navigation/i })
    await expect(bottomNav).toBeVisible()
    await expect(bottomNav.getByRole('button', { name: 'Home', exact: true })).toBeVisible()
    await expect(bottomNav.getByRole('button', { name: 'Repos', exact: true })).toBeVisible()
    await expect(bottomNav.getByRole('button', { name: 'Teams', exact: true })).toBeVisible()
  })

  test('should show Quick actions FAB on mobile', async ({ page }) => {
    // The old hamburger drawer FAB was removed (it stacked behind the
    // primary FAB at the same bottom-right slot). Quick actions is the
    // single mobile FAB now — its trigger button carries aria-label.
    const fab = page.getByRole('button', { name: 'Quick actions' })
    await expect(fab).toBeVisible()
  })

  test('should open Quick actions menu when tapping the FAB', async ({ page }) => {
    const fab = page.getByRole('button', { name: 'Quick actions' })
    // The FAB peeks 55% off-screen by default; force-click bypasses the
    // pointer interception so we can land the tap without first hovering
    // to slide it in. Single click only — the FAB toggles open/closed,
    // so a "belt and braces" double-click would just close it again.
    await fab.click({ force: true })

    // Once open the menu surfaces its items (Create / Import / AI / Search /
    // Dev Toolkit). Any of those being visible confirms the menu mounted.
    await expect(page.getByRole('menuitem', { name: /create/i }))
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
