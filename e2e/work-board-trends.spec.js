import { test, expect } from '@playwright/test'

test.describe('Work Board — KPI trends', () => {
    test.beforeEach(async ({ page }) => {
        await page.route('**/api/v1/work-board/kpi-snapshots*', route =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: [
                        { snappedAt: '2026-04-17T00:00:00Z', reviews: 3, stalePRs: 8,  issues: 5, techDebt: 12 },
                        { snappedAt: '2026-04-20T00:00:00Z', reviews: 2, stalePRs: 10, issues: 5, techDebt: 13 },
                        { snappedAt: '2026-04-23T00:00:00Z', reviews: 2, stalePRs: 12, issues: 4, techDebt: 15 },
                    ],
                }),
            })
        )
        await page.goto('/')
        await page.getByRole('button', { name: /work board/i }).click()
        await page.waitForSelector('[data-testid="kpi-row"]', { timeout: 5000 }).catch(() => {})
    })

    test('sparkline SVG polyline is rendered in KPI tile', async ({ page }) => {
        const polyline = page.locator('svg polyline').first()
        await expect(polyline).toBeVisible({ timeout: 3000 })
    })

    test('delta badge is visible on at least one KPI tile', async ({ page }) => {
        const badge = page.locator('text=/%/').first()
        await expect(badge).toBeVisible({ timeout: 3000 })
    })
})
