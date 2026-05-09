import { test, expect, devices } from '@playwright/test'

/**
 * Mobile review flow — exercises the PR-review surface on iPhone 13.
 *
 * Coverage:
 *   • The desktop file tree is hidden below md and the toolbar exposes a
 *     "Files (N)" button that opens a bottom sheet.
 *   • Selecting a file in the sheet dismisses it and updates the diff.
 *   • Files >500 changed lines render the DiffCollapser placeholder
 *     instead of the lib's full DiffView.
 *   • The DiffCollapser "Show diff" CTA expands the file on demand.
 *
 * Drives via the in-app mock-mode fixtures (VITE_MOCK_MODE=true is
 * pinned by `vite --mode test` in playwright.config.js webServer). The
 * mocks include `src/big-refactor.js` (additions=600, deletions=200)
 * that triggers the fold-by-default path.
 *
 * Skipped unless E2E_MOBILE=1 — same env gate as the rest of the mobile
 * project in playwright.config.js so this doesn't double CI runtime.
 */

test.use({ ...devices['iPhone 13'] })

test.describe('PR review — mobile flow (iPhone 13)', () => {
    test('opens a PR, navigates files via bottom sheet, exercises fold-by-default', async ({ page }) => {
        // Use the mock repo from src/__mocks__/mockRepos.js. The repo-detail
        // route is in-app-mocked so no page.route stubs are needed.
        await page.goto('/repos/dev-user/fintech-dashboard')

        // Wait for the repo header to render
        await expect(page.getByText(/fintech-dashboard/i).first()).toBeVisible()

        // Switch to Pull requests tab
        await page.getByRole('tab', { name: /Pull requests/i }).click().catch(async () => {
            await page.getByRole('link', { name: /Pull requests/i }).click()
        })

        // Open the first PR row. The mock generates titles from PR_TITLES;
        // any visible PR row works.
        const firstPR = page.getByRole('button', { name: /^#\d+/ }).first()
        if (await firstPR.isVisible().catch(() => false)) {
            await firstPR.click()
        } else {
            // Fallback — click the first link that looks like a PR title.
            await page.locator('a').filter({ hasText: /feat:|fix:|chore:|refactor:|docs:/ }).first().click()
        }

        // Find the "Start Review" CTA which routes to PRReviewView. Skip
        // the in-detail Files tab for the mobile flow — PRReviewView is
        // where the bottom-sheet + FAB live.
        const reviewBtn = page.getByRole('button', { name: /Review/i }).first()
        if (await reviewBtn.isVisible().catch(() => false)) {
            await reviewBtn.click()
        }

        // Toolbar "Files (N)" button must be present below md. It only
        // renders when CodeReviewSurface is below the md breakpoint — the
        // iPhone 13 device emulation gives us that.
        const filesBtn = page.getByRole('button', { name: /Open files list/i })
        await expect(filesBtn).toBeVisible()

        // Open the sheet
        await filesBtn.click()
        await expect(page.getByRole('dialog')).toBeVisible()

        // Select the large file
        await page.getByText('src/big-refactor.js').first().click()

        // Sheet auto-closes
        await expect(page.getByRole('dialog')).toHaveCount(0)

        // The fold-by-default placeholder is visible (>500 lines)
        await expect(page.locator('.diff-collapser')).toBeVisible()
        await expect(page.locator('.diff-collapser')).toContainText(/800 lines changed/i)

        // Expand on demand
        await page.locator('.diff-collapser').getByRole('button', { name: /Show diff/i }).click()

        // Real diff renders (DiffView's stub-id or the Tailwind wrapper)
        await expect(page.locator('.diff-renderer').first()).toBeVisible()
    })
})
