/*
 * GitHub Repo Manager
 * Mock repository data — DEV ONLY.
 *
 * Imported via dynamic import() guarded by import.meta.env.DEV.
 * Vite's dead-code elimination drops the entire import branch in
 * production builds, so no string from this file ships to dist/.
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the Apache License 2.0 (SPDX: Apache-2.0). See LICENSE in the project root.
 */

const TEMPLATES = [
  { name: 'fintech-dashboard', lang: 'TypeScript', desc: 'Real-time financial analytics dashboard with React and D3.js' },
  { name: 'ai-analytics-platform', lang: 'Python', desc: 'Machine learning pipeline for predictive customer behavior analysis' },
  { name: 'react-component-library', lang: 'TypeScript', desc: 'Enterprise-grade UI component library based on Glassmorphism' },
  { name: 'serverless-api-gateway', lang: 'Go', desc: 'High-performance API gateway for microservices architecture' },
  { name: 'mobile-app-flutter', lang: 'Dart', desc: 'Cross-platform mobile application for inventory management' },
  { name: 'kubernetes-deploy-scripts', lang: 'HCL', desc: 'Terraform modules and Helm charts for production clusters' },
  { name: 'blockchain-wallet-core', lang: 'Rust', desc: 'Secure crypto wallet core implementation with multi-chain support' },
  { name: 'e-commerce-microservices', lang: 'Java', desc: 'Spring Boot microservices for high-scale retail platform' },
  { name: 'docs-portal', lang: 'JavaScript', desc: 'Developer documentation portal built with Docusaurus' },
  { name: 'auth-service', lang: 'Go', desc: 'Centralized authentication service with OAuth2 and OIDC support' },
  { name: 'data-lake-processor', lang: 'Python', desc: 'Spark jobs for processing daily terabyte-scale logs' },
  { name: 'ios-checkout-sdk', lang: 'Swift', desc: 'Native iOS SDK for seamless checkout integration' },
  { name: 'android-pos-terminal', lang: 'Kotlin', desc: 'Point of Sale application for Android tablets' },
  { name: 'graphql-federation', lang: 'TypeScript', desc: 'Apollo Federation gateway for unified data graph' },
  { name: 'legacy-crm-importer', lang: 'PHP', desc: 'Tools for migrating data from legacy CRM systems' },
  { name: 'design-system-tokens', lang: 'CSS', desc: 'Design tokens and assets for the corporate brand identity' },
  { name: 'devops-ci-templates', lang: 'YAML', desc: 'Standardized GitHub Actions workflows for all teams' },
  { name: 'nlp-chatbot-engine', lang: 'Python', desc: 'Natural Language Processing engine for customer support bots' },
  { name: 'web-assembly-video-editor', lang: 'C++', desc: 'Browser-based video editing core using WASM' },
  { name: 'marketing-landing-pages', lang: 'HTML', desc: 'High-conversion landing pages for marketing campaigns' },
]

const TOTAL_REPOS = 87

// Deterministic per index. The numbers used to come from Math.random(), so
// the same repository showed 253 stars on the card and 234 after a reload,
// and the detail page — a separate fixture — said 42. A demo where the
// numbers move under you reads as broken, not as a demo. A small LCG seeded
// by the index gives a different but STABLE value for each repo.
function seeded(i, salt) {
  let x = (i + 1) * 2654435761 + salt * 40503
  x = (x ^ (x >>> 15)) * 2246822519
  x = (x ^ (x >>> 13)) * 3266489917
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296
}

export function mockRepoAt(i) {
  const template = TEMPLATES[i % TEMPLATES.length]
  const suffix = Math.floor(i / TEMPLATES.length) > 0 ? `-${Math.floor(i / TEMPLATES.length) + 1}` : ''
  const name = `${template.name}${suffix}`
  return {
    id: i + 1,
    name,
    full_name: `dev-user/${name}`,
    description: template.desc,
    fork: i % 5 === 0,
    private: i % 3 === 0,
    owner: { login: 'dev-user' },
    html_url: `https://github.com/dev-user/${name}`,
    default_branch: 'main',
    // Anchored to a fixed instant so "updated 3h ago" does not drift between
    // the card and the detail page rendered a minute apart.
    created_at: new Date(Date.UTC(2024, 2, 12, 9, 30) - i * 86400000 * 3).toISOString(),
    updated_at: new Date(Date.UTC(2026, 6, 15, 18, 4) - i * 3600000 * (1 + seeded(i, 1) * 9)).toISOString(),
    pushed_at: new Date(Date.UTC(2026, 6, 16, 7, 41) - i * 3600000 * (1 + seeded(i, 2) * 9)).toISOString(),
    stargazers_count: Math.floor(seeded(i, 3) * 500) + i * 10,
    forks_count: Math.floor(seeded(i, 4) * 60),
    open_issues_count: Math.floor(seeded(i, 5) * 12),
    language: template.lang,
    topics: ['react', 'typescript', 'dashboard', 'ui', 'finance'].slice(0, Math.floor(seeded(i, 6) * 5)),
  }
}

/** The same repo the list shows, by full name — so detail never disagrees with the card. */
export function mockRepoByFullName(fullName) {
  for (let i = 0; i < TOTAL_REPOS; i++) {
    const r = mockRepoAt(i)
    if (r.full_name === fullName || r.name === fullName.split('/').pop()) return r
  }
  return null
}

export function generateMockRepos(page = 1, perPage = 30) {
  const totalPages = Math.ceil(TOTAL_REPOS / perPage)
  const startIndex = (page - 1) * perPage
  const endIndex = Math.min(startIndex + perPage, TOTAL_REPOS)
  const repos = []
  for (let i = startIndex; i < endIndex; i++) repos.push(mockRepoAt(i))
  return { repos, totalPages }
}
