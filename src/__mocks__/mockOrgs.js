/*
 * GitHub Repo Manager
 * Mock organization data — DEV ONLY (see mockRepos.js header).
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the GNU AGPL v3.0 only (SPDX: AGPL-3.0-only). See LICENSE in the project root.
 */

const ACTIONS = ['PushEvent', 'PullRequestEvent', 'IssuesEvent', 'CreateEvent', 'WatchEvent']
const ACTIVITY_REPOS = ['fintech-dashboard', 'ai-analytics-platform', 'react-component-library', 'serverless-api-gateway', 'mobile-app-flutter']

export function generateMockOrgs() {
  return [
    { login: 'acme-corp', avatar_url: 'https://github.com/ghost.png', public_repos: 42, total_private_repos: 15 },
    { login: 'open-source-collective', avatar_url: 'https://github.com/ghost.png', public_repos: 128, total_private_repos: 0 },
    { login: 'startup-incubator', avatar_url: 'https://github.com/ghost.png', public_repos: 5, total_private_repos: 27 },
  ]
}

export function generateMockOrgRepos(orgLogin) {
  return Array.from({ length: 15 }, (_, i) => ({
    id: 1000 + i,
    name: `${orgLogin}-service-${i + 1}`,
    full_name: `${orgLogin}/${orgLogin}-service-${i + 1}`,
    description: `Core service ${i + 1} for ${orgLogin} infrastructure`,
    fork: i % 4 === 0,
    private: i % 3 === 0,
    owner: { login: orgLogin },
    html_url: `https://github.com/${orgLogin}/${orgLogin}-service-${i + 1}`,
    updated_at: new Date(Date.now() - i * 86400000).toISOString(),
    stargazers_count: Math.floor(Math.random() * 500),
    language: ['JavaScript', 'TypeScript', 'Python', 'Go', 'Rust'][i % 5],
  }))
}

export function generateMockStats(org = '') {
  return {
    totalRepos: org ? 42 : 87,
    publicRepos: org ? 30 : 65,
    privateRepos: org ? 12 : 22,
    forks: org ? 5 : 18,
    sources: org ? 37 : 69,
    archived: org ? 2 : 4,
    organizations: 3,
    languages: {
      TypeScript: 45,
      Python: 30,
      JavaScript: 25,
      Go: 15,
      Rust: 10,
    },
    user: { login: 'dev-user', avatar_url: 'https://github.com/ghost.png' },
  }
}

export function generateMockActivity() {
  return Array.from({ length: 15 }, (_, i) => {
    const type = ACTIONS[Math.floor(Math.random() * ACTIONS.length)]
    const repoName = ACTIVITY_REPOS[Math.floor(Math.random() * ACTIVITY_REPOS.length)]
    const timeOffset = Math.floor(Math.random() * 1000 * 60 * 60 * 24 * 3)
    return {
      id: `evt-${i}`,
      type,
      actor: { login: 'dev-user', avatar_url: 'https://github.com/ghost.png' },
      repo: { name: `dev-user/${repoName}` },
      created_at: new Date(Date.now() - timeOffset).toISOString(),
      payload: {
        commits: type === 'PushEvent' ? [{ message: 'feat: Add new dashboard widgets' }, { message: 'fix: Resolve memory leak in data processor' }] : [],
        action: type === 'PullRequestEvent' ? 'opened' : (type === 'IssuesEvent' ? 'opened' : null),
        issue: type === 'IssuesEvent' ? { title: 'Bug: Login fails on mobile devices', number: 42 } : null,
        pull_request: type === 'PullRequestEvent' ? { title: 'Feat: Implement Dark Mode Support', number: 101 } : null,
        ref_type: type === 'CreateEvent' ? 'branch' : null,
        ref: type === 'CreateEvent' ? 'feature/new-ui-components' : null,
      },
    }
  }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
}
