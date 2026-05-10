import { test, expect } from '@playwright/test'

/**
 * Live Inbox E2E tests
 *
 * The app runs in MOCK_MODE (VITE_MOCK_MODE=true) during e2e — no real GitHub
 * token is required. The InboxPanel is rendered unconditionally as part of
 * DashboardPremium; there is no localStorage gate for the inbox panel.
 *
 * The useInbox hook calls /api/gh/pulls and /api/gh/issues. In mock mode
 * these endpoints may return 401 (no real session), which causes the panel
 * to show a loading or error state. Tests therefore use expect.poll / soft
 * assertions where real data is uncertain, and check structural elements
 * (the panel title, archive/snooze buttons) that are always rendered.
 *
 * Seeding requirement: for the archive/snooze row-removal assertions to pass
 * deterministically, the /api/gh/* endpoints must return at least one item.
 * On CI this is satisfied by running the dev server with NODE_ENV=test and
 * a real (or stubbed) GITHUB_TOKEN; alternatively, configure a Playwright
 * route intercept for those endpoints if a seeding fixture is added later.
 */

test.describe('Live Inbox', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/')
        // Wait for app to fully load in mock mode
        await expect(page.getByRole('button', { name: 'Dashboard' })).toBeVisible({ timeout: 15000 })
    })

    test('inbox panel title is visible', async ({ page }) => {
        // The panel title is always rendered regardless of data state
        await expect(page.locator('#inbox-panel-title')).toBeVisible()
        await expect(page.locator('#inbox-panel-title')).toContainText(/what needs your eyes/i)
    })

    test('archive button removes the row', async ({ page }) => {
        // Wait for at least one row to appear in the active inbox section
        const rows = page.locator('section[aria-labelledby="inbox-panel-title"] ul li')
        await expect(rows.first()).toBeVisible({ timeout: 15000 })

        const firstRowTitle = await rows.first().innerText()
        await rows.first().getByLabel('Archive item').click()
        await expect(
            page.locator('section[aria-labelledby="inbox-panel-title"]'),
        ).not.toContainText(firstRowTitle)
    })

    test('keyboard shortcut "e" archives the first item', async ({ page }) => {
        // Wait for at least one row to appear in the active inbox section
        const rows = page.locator('section[aria-labelledby="inbox-panel-title"] ul li')
        await expect(rows.first()).toBeVisible({ timeout: 15000 })

        const firstRowTitle = await rows.first().innerText()
        await page.keyboard.press('e')
        await expect(
            page.locator('section[aria-labelledby="inbox-panel-title"]'),
        ).not.toContainText(firstRowTitle)
    })
})
