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
        // Mock-mode home renders the dashboard. Navigate via the bottom-nav
        // "Repos" tab to reach the repo list, then drill into the first repo.
        await page.goto('/')

        // Wait for the demo banner / dashboard to render — confirms mock
        // mode is on so we're driving through in-app fixtures.
        await expect(page.getByText(/Demo mode/i).first()).toBeVisible()

        // Bottom-nav: tap Repos. The bottom nav lives inside the mobile
        // Header and the label text is the most stable handle.
        await page.getByRole('button', { name: /^Repos$/i }).first().click()

        // Open the first repo via its title button — clicking the card
        // body would activate selection mode (multi-select), not navigate.
        const repoOpenBtn = page.getByTestId('repo-card-open').first()
        await expect(repoOpenBtn).toBeVisible({ timeout: 10_000 })
        await repoOpenBtn.click()

        // Open Pull requests tab inside repo detail
        await page.getByRole('tab', { name: /Pull requests/i }).click().catch(async () => {
            await page.getByRole('button', { name: /Pull requests/i }).click()
        })

        // Open the first PR row. PR rows are role=button with a stable
        // aria-label "Open pull request #N: <title>", so target by that
        // prefix instead of fragile text matching.
        await page.getByRole('button', { name: /^Open pull request/i }).first().click()

        // Inside PRDetailPanel: switch to the Files tab (the in-detail
        // Files tab mounts CodeReviewSurface, the same surface PRReviewView
        // uses, with the same MobileFileTreeSheet trigger below md).
        await page.getByRole('tab', { name: /^Files/i }).click()

        // Toolbar "Files (N)" button must be present below md (iPhone 13).
        // The aria-label is "Open files list (N)" — match the prefix.
        const filesBtn = page.getByRole('button', { name: /Open files list/i })
        await expect(filesBtn).toBeVisible({ timeout: 15_000 })

        // Open the sheet
        await filesBtn.click()
        await expect(page.getByRole('dialog')).toBeVisible()

        // Select the large file (full path is shown in the tree row's title attr;
        // the visible label is the basename only). Use title attr for stability.
        await page.getByTitle('src/big-refactor.js').first().click()

        // Sheet auto-closes
        await expect(page.getByRole('dialog')).toHaveCount(0)

        // The fold-by-default placeholder is visible (>500 lines)
        await expect(page.locator('.diff-collapser')).toBeVisible()
        await expect(page.locator('.diff-collapser')).toContainText(/800 lines changed/i)

        // Expand on demand
        await page.locator('.diff-collapser').getByRole('button', { name: /Show diff/i }).click()

        // Real diff renders (the lib's wrapper uses class `.diff-renderer`)
        await expect(page.locator('.diff-renderer').first()).toBeVisible()
    })
})
