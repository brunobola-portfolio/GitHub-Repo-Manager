/*
 * README honesty test — verifies README.md never advertises features that
 * don't ship as ready-to-use today. Roadmap-only items belong in the
 * `## Roadmap` section (or in ROADMAP.md), never in the headline features.
 *
 * This test is fast (no build needed), so it runs in the default vitest
 * suite — but it lives in tests/build/ alongside build-honesty.test.js so
 * everything CI-related is in one place.
 */

import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

// Phrases that imply a feature is shipping today. If any of these surface
// outside the Roadmap section, the README is overpromising.
const FORBIDDEN_IN_README = [
  'Full migration (Azure + GitLab)',
  // Launch-readiness panel 2026-07-19 finding #1: the FAQ claimed the AI
  // provider "never" receives code content, which is false — AI Deep Review
  // sends the full PR diff and the Commit Generator works from diffs. The
  // FAQ answer must stay per-feature-accurate instead of this blanket claim.
  'never your code content',
  // Precise vaporware phrases chosen so they can never false-positive on
  // honest text elsewhere in the README (e.g. "DORA Metrics" tab label,
  // "SSO / SAML (roadmap)" table row, "PostgreSQL is intentionally
  // rejected") — only the exact affirmative-shipping phrasing is forbidden.
  'DORA metrics dashboard',
  'SAML SSO included',
  'PostgreSQL support',
  'SOC 2 certified',
]

describe('README honesty', () => {
  const readme = readFileSync('README.md', 'utf8')
  // Drop the explicit ## Roadmap section so its content is allowed to
  // mention deferred features.
  const sections = readme.split(/^## /m)
  const nonRoadmap = sections
    .filter((s) => !s.toLowerCase().startsWith('roadmap'))
    .join('\n')

  for (const phrase of FORBIDDEN_IN_README) {
    it(`README must not advertise "${phrase}" outside the Roadmap section`, () => {
      expect(nonRoadmap).not.toContain(phrase)
    })
  }
})
