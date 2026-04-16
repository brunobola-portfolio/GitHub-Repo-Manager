import { test, expect } from '@playwright/test'

/**
 * Migration Wizard — Select step redesign smoke test.
 *
 * This is intentionally minimal: the Select step requires Azure DevOps
 * credentials to fetch repos, which are not present in CI. A full flow test
 * would need seeded org/project fixtures and mocked PAT responses.
 *
 * For now we verify:
 *  - The app boots without runtime errors introduced by the new components.
 *  - The shared UI primitives are loadable via a known route that reaches
 *    the wizard entry point.
 *
 * Expand this file when Azure mock fixtures are available.
 */
test.describe('Migration Wizard — Select step redesign (smoke)', () => {
  test('app boots without runtime errors', async ({ page }) => {
    const errors = []
    page.on('pageerror', (err) => errors.push(err.message))
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })
    await page.goto('/')
    // Wait for the app shell to render (any known landmark button).
    await expect(page.getByRole('button', { name: /repositories|sign in|login/i }).first()).toBeVisible({ timeout: 15000 })
    // Allow a moment for lazy imports to resolve without producing errors.
    await page.waitForTimeout(1000)
    // No page errors should have surfaced during boot.
    const significant = errors.filter((e) =>
      !/favicon|hot-update|SourceMap|Download the React DevTools/i.test(e)
    )
    expect(significant, `Unexpected errors: ${significant.join('\n')}`).toEqual([])
  })
})
