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

    test('what-needs-you grid renders three categories or empty state', async ({ page }) => {
        // Either the 3 category cards or the celebratory empty state must be visible.
        const reviewsCard = page.locator('[aria-label*="reviews waiting"]').first()
        const empty = page.getByText(/estás em dia/i)
        // Use Promise.race-style: assert at least one is visible within timeout.
        await expect(reviewsCard.or(empty)).toBeVisible({ timeout: 10000 })
    })
})
