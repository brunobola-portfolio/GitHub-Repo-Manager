import { test, expect } from '@playwright/test'

// Mock-mode is enabled via `npx vite --mode test` (see playwright.config.js).
// In mock-mode the AI suggestion API returns a deterministic shape from
// mockSuggestNameDescription() in src/__mocks__/mockAI.js, so no real AI
// provider is needed.
//
// reposApi.updateRepo() uses apiCall() → fetchWithRetry(), which is a real
// fetch wrapper with no built-in mock-mode short-circuit. We intercept the
// PATCH with page.route() to avoid a real network call (Option A — test-only,
// no production code changes). getCsrfToken() is also intercepted because
// fetchWithRetry injects an X-CSRF-Token on PATCH requests.

test.describe('Suggest Name & Description', () => {
  test('opens from context menu, applies description, shows toast', async ({ page }) => {
    // Intercept CSRF token fetch — required by fetchWithRetry before any PATCH.
    await page.route('**/api/auth/csrf-token', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'test-csrf' }),
      })
    )

    // Intercept the PATCH that applies the suggestion. The first mock repo is
    // "fintech-dashboard" (owner: dev-user). mockSuggestNameDescription returns
    // noChange.name=true for this repo (slug already matches), so only description
    // changes and no rename-ack checkbox is required before Apply becomes enabled.
    await page.route('**/api/v1/repos/dev-user/fintech-dashboard', (route) => {
      if (route.request().method() === 'PATCH') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 1,
            name: 'fintech-dashboard',
            full_name: 'dev-user/fintech-dashboard',
            description: 'TypeScript project for react',
            owner: { login: 'dev-user' },
          }),
        })
      }
      return route.fallback()
    })

    await page.goto('/')

    // Auto-auth lands on Dashboard in mock mode; repo cards live in the
    // Repositories view. Navigate there and wait for the first card.
    await expect(page.getByRole('button', { name: 'Repositories' })).toBeVisible({ timeout: 15000 })
    await page.getByRole('button', { name: 'Repositories' }).click()
    await page.waitForSelector('[data-testid="repo-card"]', { timeout: 15000 })

    // Right-click on the first repo card to open the context menu.
    const firstCard = page.locator('[data-testid="repo-card"]').first()
    await firstCard.click({ button: 'right' })

    // Navigate AI → Suggest Name & Description. Submenu items now render
    // with a description div as a sibling of the label, so the accessible
    // name is "label + description" — exact-match on label alone fails.
    // Targeting the per-item data-testid avoids the issue.
    await page.getByRole('menuitem', { name: 'AI', exact: true }).hover()
    await page.getByTestId('menu-item-ai_suggest_name_desc').click()

    // Modal renders with the title visible.
    await expect(
      page.getByRole('heading', { name: 'Suggest Name & Description' })
    ).toBeVisible()

    // Trigger the suggestion fetch — the modal does not auto-fetch on open
    // (preserves user edits across re-opens). The button label flips between
    // "Suggest with AI" / "Suggest (heuristic)" depending on AI status.
    await page.getByRole('button', { name: /^Suggest( with AI| \(heuristic\))?$/i }).click()

    // Wait for the skeleton to disappear — the mock has a 600ms delay.
    await expect(page.locator('[data-testid="suggest-skeleton"]')).toHaveCount(0, { timeout: 5000 })

    // The description field card should be visible (name has noChange=true, so
    // the name card renders as a "already great" notice, not an editable field).
    const proposedDesc = page.getByLabel(/proposed description/i)
    await expect(proposedDesc).toBeVisible()
    await expect(proposedDesc).not.toHaveValue('')

    // Apply changes — button should be enabled (description differs, no rename ack needed).
    await page.getByRole('button', { name: /Apply changes/i }).click()

    // Toast confirms the update.
    await expect(page.getByText(/Repository updated/i)).toBeVisible()
  })
})
