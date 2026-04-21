import { test, expect } from '@playwright/test'

/**
 * Work Board — zero-config UX
 *
 * In MOCK_MODE (the default for `npm run dev` and the e2e webServer config)
 * the useWorkBoard hooks return synthetic data (MOCK_REVIEWS, MOCK_STALE_PRS,
 * MOCK_TECH_DEBT, ...). A new user opening the app lands on a populated Work
 * Board instantly, no backend required. That IS the zero-config experience
 * covered by these tests — no route interception, no seeding, just navigate
 * and assert.
 */
test.describe('Work Board — zero config UX', () => {
    test('populates with synthetic data and exposes the cockpit UI', async ({ page }) => {
        await page.goto('/')
        await expect(page.getByAltText('dev-user')).toBeVisible({ timeout: 15000 })

        // Navigate to Work Board via the top tab. Both the header nav and the
        // slim sidebar expose a button named "Work Board", so narrow to the
        // first visible one (the header nav).
        await page.getByRole('button', { name: 'Work Board' }).first().click()

        // Header + refresh button
        await expect(page.getByRole('heading', { name: /work board/i })).toBeVisible()
        await expect(page.getByRole('button', { name: /refresh work board/i })).toBeVisible()

        // KPI row: all four tiles are rendered with labels
        await expect(page.getByText('Pending reviews', { exact: false })).toBeVisible()
        await expect(page.getByText('Stale PRs', { exact: false }).first()).toBeVisible()
        await expect(page.getByText('Open issues', { exact: false })).toBeVisible()
        await expect(page.getByText('Tech debt', { exact: false })).toBeVisible()

        // Tab bar
        await expect(page.getByRole('tab', { name: /my reviews/i })).toBeVisible()
        await expect(page.getByRole('tab', { name: /stale prs/i })).toBeVisible()
        await expect(page.getByRole('tab', { name: /my issues/i })).toBeVisible()

        // Synthetic data shown on default tab (My Reviews).
        // MOCK_REVIEWS has a row titled "Add rate limiting to /api/auth".
        await expect(page.getByText(/Add rate limiting/i)).toBeVisible()

        // Keyboard help modal opens on ? and closes on Escape
        await page.keyboard.press('Shift+?')
        await expect(page.getByRole('heading', { name: /keyboard shortcuts/i })).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(page.getByRole('heading', { name: /keyboard shortcuts/i })).not.toBeVisible()

        // g then t switches to Tech Debt tab
        await page.keyboard.press('g')
        await page.keyboard.press('t')
        await expect(page.getByRole('tab', { name: /tech debt/i })).toHaveAttribute('aria-selected', 'true')

        // Click the refresh button (no error)
        await page.getByRole('button', { name: /refresh work board/i }).click()
    })

    test('tab switching is URL-synced', async ({ page }) => {
        await page.goto('/')
        await expect(page.getByAltText('dev-user')).toBeVisible({ timeout: 15000 })
        await page.getByRole('button', { name: 'Work Board' }).first().click()

        await page.getByRole('tab', { name: /stale prs/i }).click()
        await expect(page).toHaveURL(/tab=stale/)

        await page.getByRole('tab', { name: /my reviews/i }).click()
        // Default tab removes the param
        await expect(page).not.toHaveURL(/tab=/)
    })
})
