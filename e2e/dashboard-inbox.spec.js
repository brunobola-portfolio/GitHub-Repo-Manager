import { test, expect } from '@playwright/test'

/**
 * Live Inbox E2E tests
 *
 * The InboxPanel is gated by the localStorage flag
 * `dashboard_premium_v2_inbox` (see DashboardPremium.jsx line ~125 and
 * src/lib/featureFlags.js). The flag must be set BEFORE the React app
 * boots and reads it, so beforeEach navigates once, sets the flag, then
 * reloads — the second mount sees the flag and renders InboxPanel.
 *
 * Seeding requirement: the row-removal assertions depend on
 * /api/v1/dashboard/inbox returning at least one item in the active
 * section. On CI this is satisfied by seeding review_assignments /
 * pr_events / issue_events before the spec runs. When data is absent
 * the tests will fail at the first `rows.first()` visibility check —
 * that is the intended signal to the operator that seeding is missing.
 */

test.describe('Live Inbox', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/')
        await expect(page.getByRole('button', { name: 'Dashboard' })).toBeVisible({ timeout: 15000 })
        await page.evaluate(() => localStorage.setItem('dashboard_premium_v2_inbox', '1'))
        await page.reload()
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

    test('snooze modal preset hides the row from default view', async ({ page }) => {
        // Wait for at least one row to appear in the active inbox section
        const rows = page.locator('section[aria-labelledby="inbox-panel-title"] ul li')
        await expect(rows.first()).toBeVisible({ timeout: 15000 })

        const firstRowTitle = await rows.first().innerText()
        await rows.first().getByLabel('Snooze item').click()
        await page.getByRole('button', { name: '1 hour' }).click()
        await expect(
            page.locator('section[aria-labelledby="inbox-panel-title"]'),
        ).not.toContainText(firstRowTitle)
    })
})
