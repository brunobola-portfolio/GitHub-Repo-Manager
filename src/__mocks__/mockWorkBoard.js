/*
 * GitHub Repo Manager
 * Mock work-board data — DEV ONLY (see mockRepos.js header).
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the MIT License. See LICENSE in the project root.
 */

const REVIEWS = [
  { repoFullName: 'acme/backend', prNumber: 142, title: 'Add rate limiting to /api/auth', authorLogin: 'alice', requestedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(), ageHours: 2 },
  { repoFullName: 'acme/frontend', prNumber: 87, title: 'Redesign dashboard cards', authorLogin: 'bob', requestedAt: new Date(Date.now() - 18 * 3600 * 1000).toISOString(), ageHours: 18 },
  { repoFullName: 'acme/infra', prNumber: 31, title: 'Migrate CI to GitHub Actions', authorLogin: 'carol', requestedAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(), ageHours: 72 },
  { repoFullName: 'acme/docs', prNumber: 12, title: 'Update API reference for v3', authorLogin: 'dave', requestedAt: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(), ageHours: 120 },
  { repoFullName: 'acme/backend', prNumber: 155, title: 'Optimise SQL queries in billing module', authorLogin: 'eve', requestedAt: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(), ageHours: 168 },
]

const STALE_PRS = Array.from({ length: 10 }, (_, i) => ({
  repoFullName: i % 2 === 0 ? 'acme/backend' : 'acme/frontend',
  prNumber: 200 + i,
  title: `Stale PR #${200 + i}: feature/${['auth', 'ui', 'perf', 'db', 'ci'][i % 5]}-improvements`,
  authorLogin: ['alice', 'bob', 'carol', 'dave', 'eve'][i % 5],
  openedAt: new Date(Date.now() - (8 + i * 3) * 24 * 3600 * 1000).toISOString(),
  ageDays: 8 + i * 3,
}))

const ISSUES = [
  { repoFullName: 'acme/backend', issueNumber: 501, labels: ['bug', 'priority:high'], openedAt: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString(), ageDays: 1 },
  { repoFullName: 'acme/frontend', issueNumber: 312, labels: ['enhancement'], openedAt: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString(), ageDays: 4 },
  { repoFullName: 'acme/docs', issueNumber: 88, labels: ['documentation'], openedAt: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString(), ageDays: 10 },
]

const REVIEW_LOAD = [
  { reviewerLogin: 'alice', reviewsSubmitted: 18, reviewsPending: 4 },
  { reviewerLogin: 'bob', reviewsSubmitted: 12, reviewsPending: 7 },
  { reviewerLogin: 'carol', reviewsSubmitted: 9, reviewsPending: 1 },
  { reviewerLogin: 'dave', reviewsSubmitted: 5, reviewsPending: 6 },
  { reviewerLogin: 'eve', reviewsSubmitted: 3, reviewsPending: 2 },
]

const TECH_DEBT = {
  items: [
    { repoFullName: 'acme/backend', issueNumber: 204, title: 'Refactor auth middleware — deprecated passport strategy', labels: ['tech-debt', 'refactor'], openedAt: new Date(Date.now() - 42 * 24 * 3600 * 1000).toISOString(), ageDays: 42, assignees: ['alice'] },
    { repoFullName: 'acme/frontend', issueNumber: 98, title: 'Remove legacy jQuery plugins from settings page', labels: ['cleanup', 'tech-debt'], openedAt: new Date(Date.now() - 21 * 24 * 3600 * 1000).toISOString(), ageDays: 21, assignees: [] },
    { repoFullName: 'acme/backend', issueNumber: 237, title: 'Replace synchronous fs.readFile with streams', labels: ['tech-debt', 'perf'], openedAt: new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString(), ageDays: 14, assignees: ['bob'] },
    { repoFullName: 'acme/infra', issueNumber: 17, title: 'Migrate Terraform workspace to 1.9+', labels: ['refactor'], openedAt: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(), ageDays: 7, assignees: [] },
  ],
  hotspots: [
    { repoFullName: 'acme/backend', count: 2, oldestAgeDays: 42 },
    { repoFullName: 'acme/frontend', count: 1, oldestAgeDays: 21 },
    { repoFullName: 'acme/infra', count: 1, oldestAgeDays: 7 },
  ],
}

const KPI_SNAPSHOTS = Array.from({ length: 7 }, (_, i) => ({
  snappedAt: new Date(Date.now() - (6 - i) * 24 * 3600 * 1000).toISOString(),
  reviews: [3, 2, 4, 3, 2, 3, 2][i],
  stalePRs: 8 + i,
  issues: 4,
  techDebt: 12 + i,
}))

let _dora = null
function makeDORA() {
  const perDay = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.now() - (29 - i) * 24 * 3600 * 1000)
    return { date: d.toISOString().split('T')[0], count: Math.floor(Math.random() * 5) }
  })
  return {
    totalDeployments: perDay.reduce((s, d) => s + d.count, 0),
    perDay,
    medianLeadTimeHours: 18.5,
    p50: 18.5,
    p90: 52,
    sampleSize: 47,
  }
}
function getDORA() {
  if (!_dora) _dora = makeDORA()
  return _dora
}

let _doraFull = null
function getDORAFull() {
  if (!_doraFull) {
    const base = getDORA()
    _doraFull = {
      environment: 'production',
      windowStart: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
      deployFrequency: { totalDeployments: base.totalDeployments, perDay: base.perDay },
      leadTime: { sampleSize: base.sampleSize, medianHours: base.medianLeadTimeHours, p50: base.p50, p90: base.p90 },
      changeFailureRate: { total: 42, failed: 5, successful: 37, rate: 0.119 },
      mttr: { sampleSize: 5, medianHours: 3.2, p50: 3.2, p90: 11.5, unresolved: 0 },
    }
  }
  return _doraFull
}

const MOCKS = {
  reviews: () => REVIEWS,
  stalePRs: () => STALE_PRS,
  issues: () => ISSUES,
  reviewLoad: () => REVIEW_LOAD,
  techDebt: () => TECH_DEBT,
  kpiSnapshots: () => KPI_SNAPSHOTS,
  dora: getDORA,
  doraFull: getDORAFull,
}

export function getMockWorkBoardData(key) {
  const factory = MOCKS[key]
  if (!factory) throw new Error(`Unknown work-board mock key: ${key}`)
  return factory()
}
