/*
 * GitHub Repo Manager
 * Mock repo-detail data — DEV + VITE_MOCK_MODE only.
 *
 * Imported via dynamic import() guarded by:
 *   import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true'
 * Vite's DCE drops the entire import branch in production bundles.
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the AGPL-3.0. See LICENSE in the project root.
 */

// Simple deterministic hash so same repo always gets same mock data.
function seed(str) {
    let h = 0
    for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0
    return Math.abs(h)
}

function pick(arr, n) {
    return arr[n % arr.length]
}

const USERS = ['alice', 'bob', 'carol', 'dave', 'eve', 'frank', 'grace', 'henry']
const LABELS = [
    { name: 'bug', color: 'd73a4a' },
    { name: 'enhancement', color: 'a2eeef' },
    { name: 'documentation', color: '0075ca' },
    { name: 'good first issue', color: '7057ff' },
    { name: 'help wanted', color: '008672' },
    { name: 'question', color: 'd876e3' },
    { name: 'refactor', color: 'fef2c0' },
    { name: 'performance', color: 'e4e669' },
]

const PR_TITLES = [
    'feat: add dark mode support',
    'fix: resolve null pointer in auth flow',
    'chore: update dependencies to latest',
    'feat: implement pagination for data tables',
    'fix: correct timezone handling in reports',
    'refactor: extract shared utility functions',
    'feat: add CSV export functionality',
    'fix: prevent duplicate form submissions',
    'docs: update API reference for v2 endpoints',
    'feat: add keyboard shortcuts for power users',
]

const ISSUE_TITLES = [
    'Button hover state not visible in dark mode',
    'Pagination resets when applying filters',
    'Export fails for datasets > 10k rows',
    'Missing loading skeleton on initial render',
    'Timezone mismatch in scheduled reports',
    'Search results include archived repositories',
    'Mobile layout broken on < 375px screens',
    'Session expires without warning dialog',
    'Label filter resets after tab switch',
    'Keyboard navigation skips some interactive elements',
]

const COMMIT_MESSAGES = [
    'fix(auth): handle token refresh race condition',
    'feat(ui): add animated skeleton loading states',
    'chore(deps): bump react to 19.1.0',
    'fix(api): correct pagination offset calculation',
    'refactor(db): extract query builder helpers',
    'feat(export): support XLSX in addition to CSV',
    'fix(mobile): resolve layout overflow on small screens',
    'perf(cache): add 5-minute TTL to repo list query',
    'docs: clarify webhook setup instructions',
    'test: add integration tests for auth middleware',
    'fix(search): exclude forks from default results',
    'feat(shortcuts): add j/k navigation to issue list',
]

const BRANCH_NAMES = [
    'feat/dark-mode',
    'fix/auth-race-condition',
    'chore/dep-updates',
    'feat/pagination-v2',
    'hotfix/export-timeout',
    'refactor/shared-utils',
]

const SHAS = [
    'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3',
    'c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    'd4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5',
    'e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6',
    'f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1',
    '1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b',
    '2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c',
    '3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d',
    '4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e',
    '5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f',
    '6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a',
]

function ago(ms) {
    return new Date(Date.now() - ms).toISOString()
}

// --- Generators ---

export function generateMockPRs(repoName) {
    const s = seed(repoName)
    const count = 3 + (s % 4)
    return Array.from({ length: count }, (_, i) => {
        const idx = (s + i) % PR_TITLES.length
        const user = pick(USERS, s + i)
        const label = LABELS[(s + i * 3) % LABELS.length]
        return {
            id: 100000 + s + i,
            number: 100 + i + (s % 50),
            title: PR_TITLES[idx],
            state: 'open',
            draft: i === count - 1,
            user: { login: user, avatar_url: `https://avatars.githubusercontent.com/u/${s + i}?v=4` },
            assignees: [{ login: pick(USERS, s + i + 2) }],
            labels: [label],
            created_at: ago((i + 1) * 86400000 * (1 + (s % 5))),
            updated_at: ago(i * 3600000 * (1 + (s % 8))),
            comments: (s + i) % 7,
            head: { ref: pick(BRANCH_NAMES, s + i), sha: SHAS[(s + i) % SHAS.length] },
            base: { ref: 'main' },
            html_url: `https://github.com/dev-user/${repoName}/pull/${100 + i}`,
            body: `This pull request implements the changes described in the title.\n\nCloses #${50 + i}.`,
        }
    })
}

export function generateMockIssues(repoName) {
    const s = seed(repoName + 'issues')
    const count = 3 + (s % 5)
    return Array.from({ length: count }, (_, i) => {
        const idx = (s + i) % ISSUE_TITLES.length
        const user = pick(USERS, s + i + 1)
        const label = LABELS[(s + i * 2) % LABELS.length]
        return {
            number: 50 + i + (s % 30),
            title: ISSUE_TITLES[idx],
            state: 'open',
            user: { login: user, avatar_url: `https://avatars.githubusercontent.com/u/${s + i + 10}?v=4` },
            assignees: i % 3 === 0 ? [{ login: pick(USERS, s + i + 3) }] : [],
            labels: [label],
            created_at: ago((i + 2) * 86400000 * (1 + (s % 4))),
            updated_at: ago(i * 7200000),
            comments: (s + i) % 5,
            html_url: `https://github.com/dev-user/${repoName}/issues/${50 + i}`,
            body: `## Summary\n\n${ISSUE_TITLES[idx]}.\n\n## Steps to reproduce\n\n1. Open the application\n2. Navigate to the affected section\n3. Observe the issue\n\n## Expected behavior\n\nThe UI should work correctly.\n\n## Actual behavior\n\nSee description above.`,
        }
    })
}

export function generateMockIssueComments(repoName, number) {
    const s = seed(repoName + number)
    const count = (s % 4)
    return Array.from({ length: count }, (_, i) => ({
        id: 1000 + i,
        user: { login: pick(USERS, s + i), avatar_url: `https://avatars.githubusercontent.com/u/${s + i + 20}?v=4` },
        created_at: ago((count - i) * 7200000),
        updated_at: ago((count - i) * 3600000),
        body: [
            'Thanks for the report! I can reproduce this on my end.',
            'This looks related to the issue we fixed in #45. Let me investigate.',
            'I have a fix in progress — should be ready by end of day.',
            'Confirmed fixed in the latest build. Closing after verification.',
        ][i % 4],
        reactions: { total_count: i, '+1': i, '-1': 0, laugh: 0, hooray: 0, confused: 0, heart: 0, rocket: 0, eyes: 0 },
    }))
}

export function generateMockCommits(repoName) {
    const s = seed(repoName + 'commits')
    return Array.from({ length: 12 }, (_, i) => {
        const sha = SHAS[(s + i) % SHAS.length]
        return {
            sha,
            commit: {
                message: COMMIT_MESSAGES[(s + i) % COMMIT_MESSAGES.length],
                author: {
                    name: pick(USERS, s + i),
                    email: `${pick(USERS, s + i)}@example.com`,
                    date: ago(i * 86400000 * (1 + (s % 3))),
                },
            },
            author: { login: pick(USERS, s + i), avatar_url: `https://avatars.githubusercontent.com/u/${s + i + 5}?v=4` },
            html_url: `https://github.com/dev-user/${repoName}/commit/${sha}`,
            stats: { additions: 20 + (s + i) % 80, deletions: 5 + (s + i) % 30, total: 25 + (s + i) % 100 },
            files: [
                {
                    filename: `src/components/${pick(['Button', 'Card', 'Modal', 'Table', 'Form'], s + i)}.jsx`,
                    additions: 15 + (s + i) % 40,
                    deletions: 3 + (s + i) % 15,
                    status: 'modified',
                    patch: `@@ -1,5 +1,8 @@\n import React from 'react'\n+import { clsx } from 'clsx'\n \n-export function Component({ children }) {\n-  return <div>{children}</div>\n+export function Component({ children, className }) {\n+  return (\n+    <div className={clsx('base-class', className)}>\n+      {children}\n+    </div>\n+  )\n }`,
                },
            ],
        }
    })
}

export function generateMockBranches(repoName) {
    const s = seed(repoName + 'branches')
    const extras = BRANCH_NAMES.slice(0, 2 + (s % 4))
    return [
        { name: 'main', protected: true, commit: { sha: SHAS[s % SHAS.length] } },
        { name: 'develop', protected: false, commit: { sha: SHAS[(s + 1) % SHAS.length] } },
        ...extras.map((name, i) => ({
            name,
            protected: false,
            commit: { sha: SHAS[(s + i + 2) % SHAS.length] },
        })),
    ]
}

export function generateMockReleases(repoName) {
    const s = seed(repoName + 'releases')
    if (s % 3 === 0) return [] // most demo repos have no releases
    return [
        {
            id: 1,
            tag_name: 'v1.2.0',
            name: 'v1.2.0 — Dark mode & performance',
            body: '## What\'s new\n\n- Added dark mode support\n- Performance improvements for large datasets\n- Various bug fixes',
            draft: false,
            prerelease: false,
            created_at: ago(15 * 86400000),
            published_at: ago(14 * 86400000),
            author: { login: pick(USERS, s) },
            html_url: `https://github.com/dev-user/${repoName}/releases/tag/v1.2.0`,
        },
    ]
}

export function generateMockPRReviews(repoName, prNumber) {
    const s = seed(repoName + prNumber + 'reviews')
    const count = s % 3
    const states = ['APPROVED', 'COMMENTED', 'CHANGES_REQUESTED']
    return Array.from({ length: count }, (_, i) => ({
        id: 2000 + i,
        user: { login: pick(USERS, s + i + 4), avatar_url: `https://avatars.githubusercontent.com/u/${s + i + 30}?v=4` },
        state: states[(s + i) % states.length],
        submitted_at: ago((count - i) * 14400000),
        body: i === 0 ? 'Looks good overall, a few minor nits below.' : '',
    }))
}

const RICH_PATCHES = [
    // src/api/client.js
    `@@ -1,12 +1,15 @@\n import axios from 'axios'\n \n-const BASE_URL = 'http://localhost:3000'\n+const BASE_URL = process.env.VITE_API_BASE || 'http://localhost:3000'\n+const PAGE_SIZE = 20\n \n export async function fetchRepos(page = 1) {\n-  const res = await axios.get(\`\${BASE_URL}/repos?page=\${page}\`)\n+  const res = await axios.get(\`\${BASE_URL}/repos\`, {\n+    params: { page, per_page: PAGE_SIZE },\n+  })\n   return res.data\n }\n \n+export async function fetchRepo(owner, name) {\n+  const res = await axios.get(\`\${BASE_URL}/repos/\${owner}/\${name}\`)\n+  return res.data\n+}\n`,
    // src/components/Button/Button.jsx
    `@@ -1,8 +1,10 @@\n import { clsx } from 'clsx'\n \n-export function Button({ children, onClick, disabled }) {\n+export function Button({ children, onClick, disabled, variant = 'primary', size = 'md' }) {\n+  const sizes = { sm: 'px-2 py-1 text-xs', md: 'px-4 py-2 text-sm', lg: 'px-6 py-3 text-base' }\n   return (\n     <button\n       onClick={onClick}\n       disabled={disabled}\n-      className="px-4 py-2 bg-indigo-600 text-white rounded-lg"\n+      className={clsx(sizes[size], variant === 'primary' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-800', 'rounded-lg transition-colors')}\n     >\n       {children}\n     </button>\n   )\n }`,
    // src/hooks/useAuth.js
    `@@ -12,7 +12,12 @@ import { useState, useEffect } from 'react'\n \n export function useAuth() {\n   const [user, setUser] = useState(null)\n+  const [loading, setLoading] = useState(true)\n \n   useEffect(() => {\n-    fetch('/api/user').then(r => r.json()).then(setUser)\n-  }, [])\n+    fetch('/api/user')\n+      .then(r => r.ok ? r.json() : Promise.reject(r.status))\n+      .then(setUser)\n+      .catch(() => setUser(null))\n+      .finally(() => setLoading(false))\n+  }, [])\n \n-  return { user }\n+  return { user, loading }\n }`,
    // src/utils/formatters.js
    `@@ -1,6 +1,20 @@\n+/** Format a number with locale-aware thousands separators */\n export function formatNumber(n) {\n-  return n.toLocaleString()\n+  if (n == null) return '—'\n+  if (n >= 1_000_000) return \`\${(n / 1_000_000).toFixed(1)}M\`\n+  if (n >= 1_000) return \`\${(n / 1_000).toFixed(1)}k\`\n+  return n.toLocaleString()\n }\n \n+/** Format an ISO date string as a relative time label */\n+export function formatRelativeTime(isoString) {\n+  if (!isoString) return ''\n+  const diff = Date.now() - new Date(isoString).getTime()\n+  const mins = Math.round(diff / 60_000)\n+  if (mins < 1) return 'just now'\n+  if (mins < 60) return \`\${mins}m ago\`\n+  const hrs = Math.round(mins / 60)\n+  if (hrs < 24) return \`\${hrs}h ago\`\n+  return \`\${Math.round(hrs / 24)}d ago\`\n+}`,
]

export function generateMockPRFiles(prNumber) {
    const s = seed(String(prNumber) + 'files')
    const fileNames = [
        'src/api/client.js',
        'src/components/Button/Button.jsx',
        'src/hooks/useAuth.js',
        'src/utils/formatters.js',
    ]
    return fileNames.map((filename, i) => ({
        sha: SHAS[(s + i) % SHAS.length],
        filename,
        status: 'modified',
        additions: [39, 40, 41, 42][i],
        deletions: [21, 2, 3, 4][i],
        changes: [60, 42, 44, 46][i],
        patch: RICH_PATCHES[i % RICH_PATCHES.length],
    }))
}

export function generateMockAssignees(repoName) {
    const s = seed(repoName + 'assignees')
    return USERS.slice(0, 3 + (s % 4)).map((login, i) => ({
        login,
        id: 1000 + i,
        avatar_url: `https://avatars.githubusercontent.com/u/${s + i + 40}?v=4`,
    }))
}

export function generateMockIssueTimeline(repoName, number) {
    const s = seed(repoName + number + 'timeline')
    return [
        {
            event: 'labeled',
            created_at: ago(86400000 * 3),
            actor: { login: pick(USERS, s), avatar_url: `https://avatars.githubusercontent.com/u/${s + 50}?v=4` },
            label: LABELS[s % LABELS.length],
        },
        {
            event: 'assigned',
            created_at: ago(86400000 * 2),
            actor: { login: pick(USERS, s + 1), avatar_url: `https://avatars.githubusercontent.com/u/${s + 51}?v=4` },
            assignee: { login: pick(USERS, s + 2) },
        },
        {
            event: 'commented',
            created_at: ago(86400000),
            actor: { login: pick(USERS, s + 3), avatar_url: `https://avatars.githubusercontent.com/u/${s + 52}?v=4` },
            body: 'Triaged and assigned. Will look into this in the next sprint.',
        },
    ].slice(0, 1 + (s % 3))
}

// --- URL matcher ---
// Returns mock data for a given URL, or undefined if the URL is not intercepted.
// Only GET-safe patterns are matched here; mutations always go to the real server
// (which in MOCK_MODE won't be called anyway since users can't sign in).

export function mockRepoDetailFetch(url) {
    // Strip query string for matching
    const [path] = url.split('?')

    // /api/repos/:owner/:repo/... patterns
    const base = '/api/repos/'
    if (!path.startsWith(base)) return undefined

    const rest = path.slice(base.length) // "owner/repo/resource/..."
    const parts = rest.split('/')
    if (parts.length < 2) return undefined

    const owner = parts[0]
    const repo = parts[1]
    const repoName = `${owner}/${repo}`
    const resource = parts[2]
    const sub1 = parts[3]
    const sub2 = parts[4]

    // /api/repos/:owner/:repo
    if (!resource) return { id: 1, name: repo, full_name: repoName, description: 'Demo repository', private: false, fork: false, owner: { login: owner }, default_branch: 'main', stargazers_count: 42, forks_count: 7, open_issues_count: 5 }

    if (resource === 'readme') return { content: btoa('# Demo Repository\n\nThis is a mock README for demo mode.'), encoding: 'base64' }

    if (resource === 'branches') {
        if (!sub1) return generateMockBranches(repoName)
        if (sub2 === 'protection') return { required_pull_request_reviews: null, required_status_checks: null }
        // Single branch
        const branches = generateMockBranches(repoName)
        return branches.find(b => b.name === decodeURIComponent(sub1)) || branches[0]
    }

    if (resource === 'releases') return generateMockReleases(repoName)

    if (resource === 'issues') {
        if (!sub1) return generateMockIssues(repoName)
        const num = parseInt(sub1, 10)
        if (!sub2) {
            const issues = generateMockIssues(repoName)
            return issues.find(i => i.number === num) || issues[0]
        }
        if (sub2 === 'comments') return generateMockIssueComments(repoName, num)
        if (sub2 === 'timeline') return generateMockIssueTimeline(repoName, num)
    }

    if (resource === 'assignees') return generateMockAssignees(repoName)

    if (resource === 'pulls') {
        if (!sub1) return generateMockPRs(repoName)
        const num = parseInt(sub1, 10)
        if (!sub2) {
            const prs = generateMockPRs(repoName)
            return prs.find(p => p.number === num) || prs[0]
        }
        if (sub2 === 'reviews') return generateMockPRReviews(repoName, num)
        if (sub2 === 'files') return generateMockPRFiles(num)
        if (sub2 === 'comments') return []
    }

    if (resource === 'commits') {
        if (!sub1) return generateMockCommits(repoName)
        // Single commit detail
        const commits = generateMockCommits(repoName)
        return commits.find(c => c.sha.startsWith(sub1)) || commits[0]
    }

    return undefined
}

export const mockDeepReviewDraft = {
    walkthrough: {
        summary: 'This PR adds OAuth token refresh logic to the auth module and updates the user session middleware to consume it.',
        perFileTable: [
            { path: 'server/auth/refresh.js', change: 'added', summary: 'New token refresh helper' },
            { path: 'server/middleware/session.js', change: 'modified', summary: 'Wires refresh into session validation' },
            { path: 'tests/auth/refresh.test.js', change: 'added', summary: 'Unit tests for the refresh helper' },
        ],
        mermaid: 'sequenceDiagram\n  Client->>Session: request\n  Session->>Refresh: maybe refresh\n  Refresh-->>Session: new token\n  Session-->>Client: ok',
        estimatedReviewTime: '12 min',
        riskLevel: 'medium',
    },
    lineComments: [
        { path: 'server/auth/refresh.js', side: 'RIGHT', line: 14, severity: 'warning', body: 'Refresh response is not validated — a malformed JSON body would crash here.', suggestion: 'const body = await res.json().catch(() => null);\nif (!body?.access_token) throw new Error("Invalid refresh response");' },
        { path: 'server/middleware/session.js', side: 'RIGHT', line: 27, severity: 'suggestion', body: 'Consider extracting the refresh check into a named function for readability.' },
        { path: 'tests/auth/refresh.test.js', side: 'RIGHT', line: 8, severity: 'info', body: 'Nice — covers both success and 401 paths.' },
    ],
    modelUsed: 'gemini-2.5-flash (mock)',
};

// Interceptor for /api/v1/repos/:owner/:repo/commits (used by useResilientFetch)
export function mockCommitsFetch(url) {
    const [path] = url.split('?')
    const m = path.match(/^\/api\/v1\/repos\/([^/]+)\/([^/]+)\/commits(?:\/([^/]+))?/)
    if (!m) return undefined
    const repoName = `${m[1]}/${m[2]}`
    if (!m[3]) return generateMockCommits(repoName)
    const commits = generateMockCommits(repoName)
    return commits.find(c => c.sha.startsWith(m[3])) || commits[0]
}
