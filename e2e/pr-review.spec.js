import { test, expect } from '@playwright/test'

/**
 * PR Review experience — smoke / regression tripwire.
 *
 * Mock mode auto-authenticates the frontend via useAuth, but the server-side
 * `/api/repos/**` routes still require a real GitHub session. To avoid a 401
 * chain when navigating repo -> PR -> review, we stub the `/api/repos/**`
 * endpoints the flow actually touches with minimal-but-realistic fixtures.
 *
 * This is a regression tripwire: each test MUST pass against the current
 * codebase. If the PR Review UI breaks (component name changes, layout
 * shuffle, keyboard handler regressed), these tests fail.
 */

const REPO_OWNER = 'dev-user'
const REPO_NAME = 'fintech-dashboard'
const PR_NUMBER = 42

const MOCK_REPO = {
    id: 1,
    name: REPO_NAME,
    full_name: `${REPO_OWNER}/${REPO_NAME}`,
    owner: { login: REPO_OWNER },
    private: true,
    html_url: `https://github.com/${REPO_OWNER}/${REPO_NAME}`,
    description: 'Mock repo for PR review E2E',
    language: 'TypeScript',
    stargazers_count: 12,
    watchers_count: 3,
    forks_count: 1,
    open_issues_count: 2,
    default_branch: 'main',
    archived: false,
    fork: false,
    topics: [],
}

const MOCK_PR = {
    id: 1001,
    number: PR_NUMBER,
    state: 'open',
    title: 'Add rate limiting to /api/auth',
    body: 'Protect auth routes against credential stuffing.',
    user: { login: 'dev-user', avatar_url: 'https://github.com/ghost.png' },
    head: { ref: 'feat/rate-limit', sha: 'deadbeef1234567890' },
    base: { ref: 'main' },
    html_url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/pull/${PR_NUMBER}`,
    created_at: '2026-04-10T10:00:00Z',
    updated_at: '2026-04-15T09:00:00Z',
    merged: false,
    merged_at: null,
    mergeable: true,
    mergeable_state: 'clean',
    draft: false,
    changed_files: 2,
    additions: 40,
    deletions: 5,
    commits: 3,
}

const MOCK_PR_FILES = [
    {
        sha: 'f1',
        filename: 'server/middleware/rate-limit.js',
        status: 'added',
        additions: 35,
        deletions: 0,
        changes: 35,
        patch: '@@ -0,0 +1,3 @@\n+export const rateLimit = () => {}\n+// mock patch\n',
    },
    {
        sha: 'f2',
        filename: 'server/routes/auth.js',
        status: 'modified',
        additions: 5,
        deletions: 5,
        changes: 10,
        patch: '@@ -1,3 +1,3 @@\n-// before\n+// after\n',
    },
]

async function mockApi(page) {

    // One regex-based route dispatches to specific fixtures by URL pathname.
    // Glob-based routes were unreliable here because Playwright globs treat `?`
    // as a single-char wildcard, which collided with query strings like
    // `/pulls?state=open`. Regex is unambiguous.
    const basePath = `/api/repos/${REPO_OWNER}/${REPO_NAME}`

    await page.route(new RegExp(`${basePath.replace(/\//g, '\\/')}(\\b|/|\\?|$)`), (route) => {
        const url = new URL(route.request().url())
        const path = url.pathname

        if (path === basePath) {
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify(MOCK_REPO) })
        }
        if (path === `${basePath}/pulls`) {
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify([MOCK_PR]) })
        }
        // /pulls/42
        if (path === `${basePath}/pulls/${PR_NUMBER}`) {
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify(MOCK_PR) })
        }
        if (path === `${basePath}/pulls/${PR_NUMBER}/reviews`) {
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify([]) })
        }
        if (path === `${basePath}/pulls/${PR_NUMBER}/files`) {
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify(MOCK_PR_FILES) })
        }
        if (path === `${basePath}/pulls/${PR_NUMBER}/comments`) {
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify([]) })
        }
        if (path === `${basePath}/issues/${PR_NUMBER}/comments`) {
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify([]) })
        }
        return route.fallback()
    })

    // AI review summary — keep quiet, test doesn't depend on it
    await page.route('**/api/ai/review-summary', (route) =>
        route.fulfill({ status: 204, body: '' })
    )
}

async function openPRReview(page) {
    // ?mockPRNumber=42 tells the dev-mode mock layer (src/__mocks__/mockRepoDetail.js)
    // to defer /api/repos/:owner/:repo/pulls* + /issues* fetches to our page.route
    // stubs above. Without this, the mock layer short-circuits the network and the
    // PR list shows generated PRs (#104..) instead of the fixture #42.
    await page.goto(`/?mockPRNumber=${PR_NUMBER}`)
    await expect(page.getByAltText('dev-user')).toBeVisible({ timeout: 15000 })

    // Repositories -> first repo with matching name.
    // exact:true targets the inner repo-name button (which navigates).
    // Without exact the locator also matches the outer card (role="button",
    // aria-label="fintech-dashboard (private)") whose click only toggles selection.
    await page.getByRole('button', { name: 'Repositories' }).click()
    await page.getByRole('button', { name: REPO_NAME, exact: true }).first().click()

    // Pull Requests tab (RepoDetail uses TabBar with role=tab)
    await page.getByRole('tab', { name: /pull requests/i }).click()

    // Click the PR card
    await page.getByRole('button', { name: new RegExp(`Open pull request #${PR_NUMBER}`, 'i') }).click()

    // PRDetailPanel is rendered; click the "Review" button to open PRReviewView.
    await page.getByRole('button', { name: /^Review$/ }).click()
}

test.describe('PR Review view', () => {
    test('opens from the PR detail and renders the review toolbar + breadcrumbs', async ({ page }) => {
        await mockApi(page)
        await openPRReview(page)

        // Breadcrumb shows repo name + Pull Requests + PR title (generous timeout
        // because PRReviewView is lazy-loaded).
        await expect(page.getByRole('navigation', { name: /breadcrumb/i })).toBeVisible({ timeout: 15000 })
        await expect(page.getByText(MOCK_PR.title).first()).toBeVisible()
        await expect(page.getByText(`#${PR_NUMBER}`, { exact: false }).first()).toBeVisible()
    })

    test('shows the split/unified toggle and submit review control', async ({ page }) => {
        await mockApi(page)
        await openPRReview(page)

        // Split/Unified buttons from ReviewToolbar
        await expect(page.getByRole('button', { name: /split view/i })).toBeVisible({ timeout: 15000 })
        await expect(page.getByRole('button', { name: /unified view/i })).toBeVisible()

        // Submit review dropdown trigger — the button itself carries
        // aria-haspopup="menu", so match with `[aria-haspopup="menu"]` + visible
        // "Review" text directly rather than filtering for a descendant.
        const submitBtn = page.locator('button[aria-haspopup="menu"]').filter({ hasText: /review/i })
        await expect(submitBtn.first()).toBeVisible()
    })

    test('shows the file list and the review progress status bar', async ({ page }) => {
        await mockApi(page)
        await openPRReview(page)

        // File tree shows the mock filenames
        await expect(page.getByText('rate-limit.js', { exact: false }).first()).toBeVisible({ timeout: 15000 })
        await expect(page.getByText('auth.js', { exact: false }).first()).toBeVisible()

        // Status bar progressbar ("X of Y files reviewed")
        await expect(
            page.getByRole('progressbar', { name: /files reviewed/i })
        ).toBeVisible()
    })

    test('pressing Escape returns to the repo detail view', async ({ page }) => {
        await mockApi(page)
        await openPRReview(page)

        // Wait until we're definitely inside PRReviewView
        await expect(page.getByRole('navigation', { name: /breadcrumb/i }))
            .toBeVisible({ timeout: 15000 })

        // Escape calls onBack -> setReviewingPR(null), setActiveView('repo-detail')
        await page.keyboard.press('Escape')

        // The Pull Requests tab of RepoDetail should be visible again
        await expect(page.getByRole('tab', { name: /pull requests/i }))
            .toBeVisible({ timeout: 10000 })
    })

    test('breadcrumb back link returns to the repo detail view', async ({ page }) => {
        await mockApi(page)
        await openPRReview(page)

        await expect(page.getByRole('navigation', { name: /breadcrumb/i }))
            .toBeVisible({ timeout: 15000 })

        // Click the "Pull Requests" crumb — it's a button with onClick=onBack.
        // force:true: CI runners are slow enough that the breadcrumb's hover
        // ring re-renders just as Playwright's stability heuristic checks,
        // making the actionability gate flap. The crumb is plainly visible —
        // force-clicking is the same behaviour a real user gets.
        await page.getByRole('button', { name: /^pull requests$/i }).first().click({ force: true })

        await expect(page.getByRole('tab', { name: /pull requests/i }))
            .toBeVisible({ timeout: 10000 })
    })
})
