/*
 * Build honesty test — verifies that the production bundle does NOT contain
 * any string that would only appear if mock data leaked through the dev-only
 * guards in src/__mocks__/. Slow (runs `vite build`) so it's excluded from
 * the default vitest run; CI invokes it explicitly via tests/build/ glob.
 */

import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, beforeAll } from 'vitest'

const FORBIDDEN_MARKERS = [
  // Function names from src/__mocks__/
  'mockAnalysis',
  'mockQualityReport',
  'mockSearchResults',
  'mockReadmeEnhancement',
  'mockBatchIndexResults',
  'mockSuggestions',
  'mockIssuePlan',
  'generateMockRepos',
  'generateMockActivity',
  'generateMockOrgs',
  'generateMockOrgRepos',
  'generateMockStats',
  'getMockWorkBoardData',
  // Distinctive sample strings — unique enough to flag a leak even after
  // minification (function names can be renamed; string literals can't).
  'nlp-chatbot-engine',
  'web-assembly-video-editor',
  'fintech-dashboard',
  'ai-analytics-platform',
  'open-source-collective',
  'startup-incubator',
]

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    const st = statSync(p)
    if (st.isDirectory()) yield* walk(p)
    else if (p.endsWith('.js') || p.endsWith('.css') || p.endsWith('.html')) yield p
  }
}

// Slow: full Vite build. Gated by RUN_BUILD_TESTS=1 so the default
// vitest run skips it. CI sets this env var explicitly.
const RUN = process.env.RUN_BUILD_TESTS === '1'

describe.skipIf(!RUN)('production build contains no mock data', () => {
  beforeAll(() => {
    // Build with no env so MOCK_MODE evaluates to false in the bundle.
    execSync('npx vite build --mode production', {
      stdio: 'inherit',
      env: { ...process.env, VITE_MOCK_MODE: '' },
    })
  }, 180_000)

  it('dist/ exists', () => {
    expect(existsSync('dist')).toBe(true)
  })

  for (const marker of FORBIDDEN_MARKERS) {
    it(`dist/ must not contain "${marker}"`, () => {
      const offenders = []
      for (const file of walk('dist')) {
        const content = readFileSync(file, 'utf8')
        if (content.includes(marker)) offenders.push(file)
      }
      expect(offenders, `Found "${marker}" in: ${offenders.join(', ')}`).toEqual([])
    })
  }
})
