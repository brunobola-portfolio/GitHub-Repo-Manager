import { test, expect } from '@playwright/test'

test.use({ viewport: { width: 375, height: 667 } })

test.describe('Mobile nav + quick actions', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/')
        // Wait for app to fully load (mock mode default)
        await expect(page.getByRole('navigation', { name: /main navigation/i })).toBeVisible({ timeout: 15000 })
    })

    test('bottom-nav shows 5 items including Work Board', async ({ page }) => {
        const nav = page.getByRole('navigation', { name: /main navigation/i })
        await expect(nav).toBeVisible()
        await expect(nav.getByRole('button', { name: /home/i })).toBeVisible()
        await expect(nav.getByRole('button', { name: /repos/i })).toBeVisible()
        await expect(nav.getByRole('button', { name: /work/i })).toBeVisible()
        await expect(nav.getByRole('button', { name: /teams/i })).toBeVisible()
        await expect(nav.getByRole('button', { name: /more/i })).toBeVisible()
    })

    test('More button opens a sheet with Settings/Logout', async ({ page }) => {
        // Pricing left the More sheet 2026-09-05 (2026-09-04 panel, R1) — it's
        // reached from the user (avatar) menu's "Plans & billing" instead,
        // covered by the next test.
        await page.getByRole('button', { name: /more/i }).click()
        await expect(page.getByRole('button', { name: /settings/i })).toBeVisible()
        await expect(page.getByRole('button', { name: /logout/i })).toBeVisible()
    })

    test('Pricing is reachable from the user menu as "Plans & billing"', async ({ page }) => {
        await page.getByLabel(/open user menu/i).click()
        const item = page.getByRole('menuitem', { name: /plans.*billing/i })
        await expect(item).toBeVisible()
        await item.click()
        await expect(page.getByRole('heading', { name: /pricing|plans/i }).first()).toBeVisible({ timeout: 10000 })
    })

    test('FAB expands and exposes Create/Import/Dev Toolkit', async ({ page }) => {
        await page.getByRole('button', { name: /quick actions/i }).click()
        await expect(page.getByRole('menuitem', { name: /create/i })).toBeVisible()
        await expect(page.getByRole('menuitem', { name: /import/i })).toBeVisible()
        await expect(page.getByRole('menuitem', { name: /dev toolkit/i })).toBeVisible()
    })

    test('Pressing Escape closes the FAB', async ({ page }) => {
        await page.getByRole('button', { name: /quick actions/i }).click()
        await expect(page.getByRole('menuitem', { name: /create/i })).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(page.getByRole('menuitem', { name: /create/i })).not.toBeVisible()
    })
})
