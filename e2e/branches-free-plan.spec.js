import { test, expect } from '@playwright/test'

const REPO_OWNER = 'dev-user'
const REPO_NAME = 'fintech-dashboard'

const MOCK_REPO = {
    id: 1, name: REPO_NAME, full_name: `${REPO_OWNER}/${REPO_NAME}`,
    owner: { login: REPO_OWNER },
    private: true,
    html_url: `https://github.com/${REPO_OWNER}/${REPO_NAME}`,
    description: 'Mock', language: 'JavaScript',
    stargazers_count: 0, watchers_count: 0, forks_count: 0, open_issues_count: 0,
    default_branch: 'main', archived: false, fork: false, topics: [],
}

const MOCK_BRANCHES = [
    { name: 'main', commit: { sha: 'a'.repeat(40), author: { date: '2026-05-08T10:00:00Z' } }, protected: false },
]

async function mockApi(page) {
    const basePath = `/api/repos/${REPO_OWNER}/${REPO_NAME}`
    await page.route(new RegExp(`${basePath.replace(/\//g, '\\/')}(\\b|/|\\?|$)`), (route) => {
        const path = new URL(route.request().url()).pathname
        if (path === basePath) {
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify(MOCK_REPO) })
        }
        if (path === `${basePath}/branches`) {
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify(MOCK_BRANCHES) })
        }
        if (path === `${basePath}/branches/main/protection`) {
            // Free-plan-private 403 with the structured code that maps to GITHUB_PRO_REQUIRED.
            return route.fulfill({
                status: 403,
                contentType: 'application/json',
                body: JSON.stringify({
                    error: 'Upgrade to GitHub Pro or make this repository public to enable this feature.',
                    code: 'GITHUB_PRO_REQUIRED',
                }),
            })
        }
        return route.fallback()
    })
}

test.describe('Branches tab — free-plan-private', () => {
    // Deep-linked via the hash router (#/repo/:owner/:name/:tab, shipped with the
    // App.jsx useAppRouter split). The original path-based goto('/repos/...') had
    // no URL→state path and landed on the dashboard. `?e2eRepoApiLive=branches`
    // makes the MOCK_MODE repo-detail layer yield the branches + protection
    // endpoints to the page.route stubs below, so the free-plan 403 actually
    // reaches the component instead of the deterministic mock's 200.
    test('shows one inline Pro chip and produces no formatUserError unmapped warnings', async ({ page }) => {
        const noisyWarns = []
        page.on('console', (msg) => {
            if (msg.type() !== 'warning' && msg.type() !== 'warn') return
            const text = msg.text()
            if (/\[formatUserError\] unmapped/i.test(text)) noisyWarns.push(text)
        })

        await mockApi(page)
        await page.goto(`/?e2eRepoApiLive=branches#/repo/${REPO_OWNER}/${REPO_NAME}/branches`)

        // The big upgrade card heading must NOT exist
        await expect(page.getByRole('heading', { name: /Branch protection requires GitHub Pro/i })).toHaveCount(0)

        // The inline chip on the default-branch row must be visible
        await expect(page.getByText(/Pro to protect/i)).toBeVisible()

        // No unmapped-error warnings on this tab open
        expect(noisyWarns).toEqual([])
    })
})
