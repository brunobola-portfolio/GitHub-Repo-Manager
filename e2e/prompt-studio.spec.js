import { test, expect } from '@playwright/test'

/**
 * Prompt Studio (slice 1b) — MOCK_MODE smoke.
 *
 * In mock mode the Express server is real but the GH proxy routes
 * short-circuit, so we still need to stub the new
 * `/api/ai/prompt-studio/presets` endpoint that drives this page.
 *
 * The page is deep-linkable via `#/ai/prompts`. App.jsx wires a
 * `hashchange` listener that maps the hash to `activeView=prompt-studio`,
 * so navigating via URL works in both dev and prod.
 */

const BUILTIN_PRESETS = [
    { id: 'general', builtin: true, name: 'General', scope: 'user', severityFloor: null, isDefault: true },
    { id: 'security', builtin: true, name: 'Security audit', scope: 'user', severityFloor: 'warning' },
    { id: 'performance', builtin: true, name: 'Performance', scope: 'user', severityFloor: null },
    { id: 'accessibility', builtin: true, name: 'Accessibility', scope: 'user', severityFloor: null },
    { id: 'refactor', builtin: true, name: 'Refactor coach', scope: 'user', severityFloor: 'info' },
]

async function stubStudio(page) {
    await page.route('**/api/ai/prompt-studio/presets', (route) => {
        if (route.request().method() === 'GET') {
            return route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify({ presets: BUILTIN_PRESETS }),
            })
        }
        return route.fallback()
    })
}

test.describe('Prompt Studio (mock mode)', () => {
    test('free user can browse built-in presets', async ({ page }) => {
        await stubStudio(page)

        // ?mockPRNumber=42 keeps parity with other AI specs (the value is
        // ignored here but ensures the dev mock layer is loaded). The hash
        // triggers App.jsx's hashchange listener -> activeView=prompt-studio.
        await page.goto('/?mockPRNumber=42#/ai/prompts')

        await expect(page.getByRole('heading', { name: /prompt studio/i })).toBeVisible({ timeout: 15000 })

        // Built-in presets render
        await expect(page.getByText('General').first()).toBeVisible()
        await expect(page.getByText('Security audit').first()).toBeVisible()

        // Free-tier upgrade hint visible (license endpoint defaults to 'free'
        // in MOCK_MODE — see useLicense.js).
        await expect(page.getByText(/upgrade to pro/i).first()).toBeVisible()

        // The "+ New preset" button is disabled for free users.
        const newBtn = page.getByRole('button', { name: /new preset/i })
        await expect(newBtn).toBeDisabled()
    })
})
