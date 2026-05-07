import { test, expect } from '@playwright/test'

/**
 * AI Deep Review (slice 1a) — MOCK_MODE smoke.
 *
 * In mock mode the new `/api/ai/deep-review/...` endpoints don't exist on
 * the (absent) server — the `useAIDeepReview` hook self-fulfills with the
 * `mockDeepReviewDraft` fixture. This spec verifies the end-to-end flow:
 * navigate to a PR's review surface -> Generate -> see the walkthrough ->
 * switch to comments -> dismiss one -> open the publish modal.
 *
 * Server-side `/api/repos/**` routes still need stubs (mock mode auto-auths
 * the frontend but the express server is real and would 401 these calls).
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
    description: 'Mock repo for AI Deep Review E2E',
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
    title: 'Add OAuth token refresh',
    body: 'OAuth refresh.',
    user: { login: 'dev-user', avatar_url: 'https://github.com/ghost.png' },
    head: { ref: 'feat/oauth-refresh', sha: 'cafef00d' },
    base: { ref: 'main' },
    html_url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/pull/${PR_NUMBER}`,
    created_at: '2026-04-10T10:00:00Z',
    updated_at: '2026-04-15T09:00:00Z',
    merged: false,
    merged_at: null,
    mergeable: true,
    mergeable_state: 'clean',
    draft: false,
    changed_files: 3,
    additions: 60,
    deletions: 5,
    commits: 2,
}

const MOCK_PR_FILES = [
    {
        sha: 'f1',
        filename: 'server/auth/refresh.js',
        status: 'added',
        additions: 35,
        deletions: 0,
        changes: 35,
        patch: '@@ -0,0 +1,3 @@\n+export const refresh = () => {}\n+// mock patch\n',
    },
    {
        sha: 'f2',
        filename: 'server/middleware/session.js',
        status: 'modified',
        additions: 5,
        deletions: 5,
        changes: 10,
        patch: '@@ -1,3 +1,3 @@\n-// before\n+// after\n',
    },
]

async function mockApi(page) {
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

    // AI review summary endpoint isn't relevant to deep-review; quiet it.
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

    await page.getByRole('button', { name: 'Repositories' }).click()
    await page.getByRole('button', { name: REPO_NAME, exact: true }).first().click()

    await page.getByRole('tab', { name: /pull requests/i }).click()
    await page.getByRole('button', { name: new RegExp(`Open pull request #${PR_NUMBER}`, 'i') }).click()

    await page.getByRole('button', { name: /^Review$/ }).click()
}

test.describe('AI Deep Review (mock mode)', () => {
    // Unblocked via the `?mockPRNumber=N` URL hook — see openPRReview() and
    // src/__mocks__/mockRepoDetail.js. With that flag set, the dev-mode
    // mock layer yields control for /pulls + /issues paths so Playwright's
    // page.route stubs supply the fixture PR #42.
    test('user can generate, see walkthrough, dismiss a comment, and open publish modal', async ({ page }) => {
        await mockApi(page)
        await openPRReview(page)

        // The AIReviewPanel is the third column inside PRReviewView. The hook
        // (in mock mode) loads the fixture immediately on mount, so the
        // walkthrough summary should be visible without clicking "Generate".
        await expect(
            page.getByText(/oauth token refresh logic/i).first()
        ).toBeVisible({ timeout: 15000 })

        // Switch to the Comments tab inside the AIReviewPanel. force:true
        // bypasses CI-only intercept-checks: framer-motion stagger
        // animations transiently overlap the tab strip on slower runners
        // and Playwright's actionability heuristic backs off until the
        // 15s timeout. The button is reachable visually; force-clicking is
        // safe because there's no overlapping-but-intentional UI here.
        await page.getByRole('button', { name: /comments \(\d+\)/i }).click({ force: true })

        // Verify a fixture comment is visible (multiple matches across panel
        // and aria region — first() is enough for the smoke check).
        await expect(
            page.getByText(/refresh response is not validated/i).first()
        ).toBeVisible()

        // Open the publish modal
        await page.getByRole('button', { name: /publish to github/i }).click()

        // Modal opens with walkthrough preview
        await expect(page.getByRole('dialog')).toBeVisible()
        await expect(page.getByText(/walkthrough preview/i)).toBeVisible()
    })
})
