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

export function generateMockRepos(page = 1, perPage = 30) {
  const totalRepos = 87
  const totalPages = Math.ceil(totalRepos / perPage)
  const startIndex = (page - 1) * perPage
  const endIndex = Math.min(startIndex + perPage, totalRepos)
  const repos = []
  for (let i = startIndex; i < endIndex; i++) {
    const template = TEMPLATES[i % TEMPLATES.length]
    const suffix = Math.floor(i / TEMPLATES.length) > 0 ? `-${Math.floor(i / TEMPLATES.length) + 1}` : ''
    repos.push({
      id: i + 1,
      name: `${template.name}${suffix}`,
      full_name: `dev-user/${template.name}${suffix}`,
      description: template.desc,
      fork: i % 5 === 0,
      private: i % 3 === 0,
      owner: { login: 'dev-user' },
      html_url: `https://github.com/dev-user/${template.name}${suffix}`,
      updated_at: new Date(Date.now() - i * 3600000 * (Math.random() * 10)).toISOString(),
      stargazers_count: Math.floor(Math.random() * 500) + (i * 10),
      language: template.lang,
      topics: ['react', 'typescript', 'dashboard', 'ui', 'finance'].slice(0, Math.floor(Math.random() * 5)),
    })
  }
  return { repos, totalPages }
}
