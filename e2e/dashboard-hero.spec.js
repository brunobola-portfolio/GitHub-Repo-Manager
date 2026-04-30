import { test, expect } from '@playwright/test'

test.describe('Dashboard hero', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/')
        // Wait for app to fully load in mock mode (matches the pattern in dashboard.spec.js)
        await expect(page.getByRole('button', { name: 'Dashboard' })).toBeVisible({ timeout: 15000 })
    })

    test('renders greeting headline', async ({ page }) => {
        const heading = page.getByRole('heading', { level: 1 })
        await expect(heading).toBeVisible()
        await expect(heading).toContainText(/bom dia|boa tarde|boa noite|olá/i)
    })

    test('renders the org filter chip', async ({ page }) => {
        await expect(page.getByLabel(/filter by organization/i)).toBeVisible()
    })

    test('renders the time range chip', async ({ page }) => {
        await expect(page.getByLabel(/time range/i)).toBeVisible()
    })

    test('time range chip changes the selected value', async ({ page }) => {
        await page.getByLabel(/time range/i).click()
        await page.getByRole('button', { name: /últimos 30 dias/i }).click()
        await expect(page.getByLabel(/time range/i)).toContainText(/30/)
    })

    test('what-needs-you grid resolves to a non-loading state', async ({ page }) => {
        // The grid has three valid terminal states:
        //   1. cards    — at least one category has data
        //   2. empty    — total === 0, "Estás em dia" celebratory tile
        //   3. hidden   — all three endpoints returned 401/403/404 and the
        //                 component intentionally renders null (e2e mock mode
        //                 hits this because the backend's requireAuth has no
        //                 real session, even though the frontend mocks one).
        // The test passes if we reach any of those — the only failure case
        // is getting stuck on the loading skeleton.
        const reviewsCard = page.locator('[aria-label*="reviews waiting"]').first()
        const empty = page.getByText(/estás em dia/i)
        const skeleton = page.locator('[data-testid="skeleton-card"]').first()

        await expect
            .poll(
                async () => {
                    if (await reviewsCard.isVisible().catch(() => false)) return 'cards'
                    if (await empty.isVisible().catch(() => false)) return 'empty'
                    if (await skeleton.isVisible().catch(() => false)) return 'loading'
                    return 'hidden'
                },
                { timeout: 10000, message: 'WhatNeedsYouGrid never left the loading state' },
            )
            .not.toBe('loading')
    })
})
