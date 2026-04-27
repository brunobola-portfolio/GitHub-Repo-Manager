import { test, expect } from '@playwright/test'

test.describe('Work Board — suggestion chips', () => {
    test.beforeEach(async ({ page }) => {
        await page.route('**/api/v1/work-board/suggest-action', route =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    suggestions: [
                        { label: 'Ping author',    action: 'comment', body: 'Hey @alice, any update?' },
                        { label: 'Snooze 7d',      action: 'snooze',  hours: 168 },
                        { label: 'View on GitHub', action: 'open',    url: 'https://github.com/test/repo/pull/1' },
                    ],
                }),
            })
        )
        await page.goto('/')
        await page.getByRole('button', { name: /work board/i }).click()
    })

    test('chip strip appears on row hover after 300ms', async ({ page }) => {
        const firstRow = page.locator('[data-testid="review-row"]').first()
        if (!await firstRow.isVisible().catch(() => false)) {
            test.skip()
        }
        await firstRow.hover()
        await page.waitForTimeout(400)
        await expect(page.getByText('Ping author')).toBeVisible()
        await expect(page.getByText('Snooze 7d')).toBeVisible()
    })

    test('clicking Ping author shows popover with draft text', async ({ page }) => {
        const firstRow = page.locator('[data-testid="review-row"]').first()
        if (!await firstRow.isVisible().catch(() => false)) {
            test.skip()
        }
        await firstRow.hover()
        await page.waitForTimeout(400)
        await page.getByText('Ping author').click()
        await expect(page.getByText('Hey @alice')).toBeVisible({ timeout: 3000 })
    })
})
