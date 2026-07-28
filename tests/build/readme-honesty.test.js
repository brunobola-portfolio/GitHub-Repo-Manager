/*
 * README honesty test — verifies README.md never advertises features that
 * don't ship as ready-to-use today. Roadmap-only items belong in the
 * `## Roadmap` section (or in ROADMAP.md), never in the headline features.
 *
 * This test is fast (no build needed), so it runs in the default vitest
 * suite — but it lives in tests/build/ alongside build-honesty.test.js so
 * everything CI-related is in one place.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
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

  // A stale prerequisite is worse than a missing one: a self-hoster on the
  // version the README names watches `npm install` fail against an engines
  // range it never mentioned. The floor moved to 22 with connect-redis 10 and
  // the README kept saying 20 — mechanical drift, so gate it mechanically.
  it('states the same minimum Node version as package.json engines', () => {
    const engines = JSON.parse(readFileSync('package.json', 'utf8')).engines?.node || ''
    const required = Number(engines.match(/>=\s*(\d+)/)?.[1])
    expect(required, `could not parse a minimum major from engines.node "${engines}"`).toBeGreaterThan(0)

    const claimed = [...readme.matchAll(/Node(?:\.js)?\s+(\d+)\+/g)].map((m) => Number(m[1]))
    expect(claimed.length, 'README no longer states a Node version at all').toBeGreaterThan(0)

    const wrong = [...new Set(claimed.filter((v) => v !== required))]
    expect(wrong, `README claims Node ${wrong.join('/')}+ but engines.node is "${engines}"`).toEqual([])
  })
})

describe('WORK_BOARD_AI_ENABLED blast radius', () => {
  // The README's † note and the in-app pricing footnote both promise that the
  // floating conversational Repo Advisor (POST /api/ai/chat) needs no
  // deployment flag, and that only the Work Board's card is gated. That
  // promise is only true while requireWorkBoardAI stays confined to the
  // Work Board router — v4.11.0 shipped the opposite claim to the pricing
  // page precisely because nothing checked it.
  it('gates only the Work Board router, which is what the pricing copy claims', () => {
    const routeFiles = readdirSync('server/routes', { recursive: true })
      .filter((f) => typeof f === 'string' && f.endsWith('.js'))
    const gated = routeFiles.filter((f) =>
      /requireWorkBoardAI/.test(readFileSync(join('server/routes', f), 'utf8')),
    )
    expect(gated.sort(), 'update the README † note and FeatureComparison footnote to match').toEqual(
      ['work-board-ai.js'],
    )
  })
})

describe('docs map freshness', () => {
  // docs/index.md advertises "The 3 latest" releases. It silently rots every
  // time a release ships without someone remembering to edit it, and a reader
  // has no way to tell a stale list from a current one.
  it('lists the newest released version from CHANGELOG.md', () => {
    const changelog = readFileSync('CHANGELOG.md', 'utf8')
    // Skip [Unreleased]; take the first real version heading.
    const newest = changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m)?.[1]
    expect(newest, 'no released version heading found in CHANGELOG.md').toBeTruthy()

    const index = readFileSync('docs/index.md', 'utf8')
    const listed = [...index.matchAll(/^- \*\*v(\d+\.\d+\.\d+)/gm)].map((m) => m[1])
    expect(listed.length, 'docs/index.md no longer lists releases').toBeGreaterThan(0)

    expect(listed[0], `docs/index.md leads with v${listed[0]} but CHANGELOG's newest is ${newest}`).toBe(newest)
  })
})
