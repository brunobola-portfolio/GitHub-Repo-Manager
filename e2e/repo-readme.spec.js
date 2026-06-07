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

// Base64-encoded markdown payload — emulates GitHub's contents-API README response.
function b64(s) { return Buffer.from(s, 'utf-8').toString('base64') }

const README_MD = `# Hello

| h1 | h2 |
|----|----|
| a  | b  |

![banner](./banner.png)

\`\`\`js
const x = 1
\`\`\`
`

const MOCK_README = {
    name: 'README.md',
    path: 'README.md',
    content: b64(README_MD),
    encoding: 'base64',
}

async function mockApi(page) {
    const basePath = `/api/repos/${REPO_OWNER}/${REPO_NAME}`
    await page.route(new RegExp(`${basePath.replace(/\//g, '\\/')}(\\b|/|\\?|$)`), (route) => {
        const path = new URL(route.request().url()).pathname
        if (path === basePath) {
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify(MOCK_REPO) })
        }
        if (path === `${basePath}/readme`) {
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify(MOCK_README) })
        }
        return route.fallback()
    })
}

test.describe('Repo Overview — README rendering', () => {
    // Deep-linked via the hash router (#/repo/:owner/:name → Overview tab). The
    // original path-based goto('/repos/...') had no URL→state path and landed on
    // the dashboard. `?e2eRepoApiLive=readme` makes the MOCK_MODE repo-detail
    // layer yield the readme endpoint to the page.route stub below, so this
    // spec's bespoke markdown (not the generic mock README) is rendered.
    test('renders the README as real markdown (table + code), not raw <pre>', async ({ page }) => {
        await mockApi(page)
        await page.goto(`/?e2eRepoApiLive=readme#/repo/${REPO_OWNER}/${REPO_NAME}`)

        // The Overview tab is the default. Wait for it to settle.
        await expect(page.getByRole('heading', { level: 1, name: /^Hello$/ })).toBeVisible()

        // GFM table renders
        await expect(page.getByRole('table')).toBeVisible()
        await expect(page.getByRole('cell', { name: 'a' })).toBeVisible()

        // Banner image src rewritten to raw.githubusercontent.com
        const banner = page.locator('img[alt="banner"]').first()
        await expect(banner).toBeVisible()
        await expect(banner).toHaveAttribute('src', /raw\.githubusercontent\.com\/dev-user\/fintech-dashboard\/main\/banner\.png/)

        // Raw markdown source must NOT be visible as text
        await expect(page.getByText('| h1 | h2 |')).toHaveCount(0)
    })
})
