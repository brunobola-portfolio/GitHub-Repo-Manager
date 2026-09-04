/*
 * Flag-to-consumer gate.
 *
 * The pricing-parity suite proves doc <-> flag agreement. It cannot prove the
 * flag does anything. `auditExport: true` sat in TIER_FEATURES with ZERO
 * consumers anywhere in the codebase while docs/LICENSE-COMMERCIAL.md sold it
 * as an Enterprise deliverable — a "Yes" in a pricing table backed by a boolean
 * nobody read is indistinguishable from a real feature until a customer asks
 * for it. `maxRepos` was the same defect in the other direction: advertised as
 * Free's ceiling and Pro's lead upgrade reason, never incremented, never
 * checked.
 *
 * Every key in TIER_FEATURES must therefore be referenced somewhere outside
 * feature-flags.js itself, and every metric must map to a real flag.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { describe, it, expect } from 'vitest'
import { getFeatures } from '../../server/lib/feature-flags.js'

const SEARCH_ROOTS = ['server', 'src']
const SKIP_DIRS = new Set(['node_modules', 'dist', '__tests__', '.vite', 'coverage'])
const CODE_EXT = new Set(['.js', '.jsx', '.mjs'])

// The flags module defines the keys; a reference inside it proves nothing.
const FLAGS_FILE = 'server/lib/feature-flags.js'

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        if (SKIP_DIRS.has(entry)) continue
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) walk(full, out)
        else if (CODE_EXT.has(extname(entry))) out.push(full)
    }
    return out
}

const sourceFiles = SEARCH_ROOTS.flatMap((root) => walk(root))
const corpus = sourceFiles
    .filter((f) => f.replace(/\\/g, '/') !== FLAGS_FILE)
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n')

// Comments are prose ABOUT flags, not consumers of them. Stripping them stops
// "// TODO: gate this behind auditExport" from satisfying the gate.
//
// Stripped PER FILE, before joining. Run over the concatenated corpus, a `/*`
// in one file pairs with a `*/` in an unrelated later one and silently deletes
// every file in between — which is not a theoretical risk: it swallowed
// server/routes/audit.js whole, and the gate then reported a flag as orphaned
// while its consumer sat two lines above.
const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')

const codeCorpus = sourceFiles
    .filter((f) => f.replace(/\\/g, '/') !== FLAGS_FILE)
    .map((f) => stripComments(readFileSync(f, 'utf8')))
    .join('\n')

/**
 * True when the corpus actually READS this flag, rather than merely containing
 * its name somewhere.
 *
 * A bare `corpus.includes(key)` passed on any substring hit — a flag named
 * `sso` is satisfied by the letters inside "successor", and a mention in a
 * comment or an unrelated longer identifier counted as a consumer. A pricing
 * claim backed by a flag nothing reads is a false claim, which is precisely
 * what this gate exists to catch, so the match has to look like a read.
 */
function isFlagRead(key) {
    const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const patterns = [
        new RegExp(`\\.\\s*${k}\\b`),                    // features.auditExport
        new RegExp(`\\[\\s*['"\`]${k}['"\`]\\s*\\]`),    // features['auditExport']
        new RegExp(`\\{[^{}]*\\b${k}\\b[^{}]*\\}\\s*=`), // const { auditExport } = ...
        new RegExp(`\\(\\s*['"\`]${k}['"\`]`),           // requireFeature('auditExport')
        // METRIC_TO_FEATURE maps a metric onto a flag NAME, and checkUsageLimit
        // then does features[featureKey] — so appearing as the value of that map
        // is a real consumption path, not a mention.
        new RegExp(`:\\s*['"\`]${k}['"\`]`),
    ]
    return patterns.some((re) => re.test(codeCorpus))
}

const flagsSource = readFileSync(FLAGS_FILE, 'utf8')

function tierFeatureKeys() {
    // Read the keys straight out of the module rather than re-declaring them,
    // so a newly added flag is covered the moment it exists. The union across
    // all three tiers matters: auditExport exists only under enterprise, and
    // reading just the free block would have missed the exact flag that
    // motivated this gate.
    const block = flagsSource.slice(
        flagsSource.indexOf('const TIER_FEATURES'),
        flagsSource.indexOf('export function getFeatures'),
    )
    return [...new Set([...block.matchAll(/^\s{4,}([a-zA-Z][a-zA-Z0-9]*)\s*:/gm)].map((m) => m[1]))]
}

// Flags that legitimately have no consumer because they gate nothing: the
// 2026-07-18 free-first rebalance made these universally available, and they
// survive only as the source of truth the pricing-parity suite reads when it
// asserts a row is Free on every tier.
//
// The exemption is CONDITIONAL — see the test below. A flag may only sit here
// while it is identical across all three tiers, so this list can never be used
// to hide a real paid claim behind an unimplemented boolean.
const DOCUMENTATION_ONLY_FLAGS = new Set([
    'migrationRiskAnalysis',
    'basicBulk',
    'syncRepository',
    'syncPreview',
    // Surfaced by the substring->read tightening below: each of these is `true`
    // on every tier, so it gates nothing and the conditional exemption applies.
    // The previous gate matched them by accident — `aiAssistant` on the
    // unrelated `aiAssistantEnabled` user preference, `prReview` on
    // `prReviewCommentSchema`.
    'bulkAdvanced',
    'aiAssistant',
    // SSO/SAML is roadmap, not shipped: false on every tier, and every surface
    // marks it as such. If it is ever flipped true anywhere, the
    // identical-across-tiers test below fails and demands a real consumer.
    'sso',
])

describe('every tier feature flag has a consumer', () => {
    const keys = tierFeatureKeys()

    it('found the TIER_FEATURES keys (guards against a parser regression)', () => {
        expect(keys.length).toBeGreaterThan(20)
        expect(keys).toContain('auditExport')
        expect(keys).toContain('apiKeys')
    })

    it('no flag is defined-but-unused', () => {
        const orphans = keys
            .filter((key) => !isFlagRead(key))
            .filter((key) => !DOCUMENTATION_ONLY_FLAGS.has(key))
        expect(
            orphans,
            `These TIER_FEATURES keys have no consumer outside ${FLAGS_FILE}. Either wire them up or delete them — a pricing claim backed by an unread boolean is a false claim:\n  ${orphans.join('\n  ')}`,
        ).toEqual([])
    })

    it('every documentation-only flag really is identical across tiers', () => {
        const tiers = ['free', 'pro', 'enterprise']
        const differing = [...DOCUMENTATION_ONLY_FLAGS].filter((key) => {
            const values = tiers.map((t) => JSON.stringify(getFeatures(t)?.[key]))
            return new Set(values).size !== 1
        })
        expect(
            differing,
            `A documentation-only flag differs between tiers, so it IS a paid differentiator and needs a real consumer:\n  ${differing.join('\n  ')}`,
        ).toEqual([])
    })

    it('the exemption list has no stale entries', () => {
        const stale = [...DOCUMENTATION_ONLY_FLAGS].filter(
            (key) => !keys.includes(key) || isFlagRead(key),
        )
        expect(
            stale,
            `These are exempted but no longer need to be (removed from TIER_FEATURES, or they now have a consumer) — delete them from the list:\n  ${stale.join('\n  ')}`,
        ).toEqual([])
    })
})

describe('every metered metric maps to a real flag', () => {
    // checkUsageLimit falls back to `features[metric] ?? Infinity`, so a metric
    // with no METRIC_TO_FEATURE entry AND no same-named flag is silently
    // unlimited — enforcement that looks deliberate but is a typo.
    const usageSource = readFileSync('server/lib/usage-meter.js', 'utf8')
    const mapBlock = usageSource.slice(
        usageSource.indexOf('METRIC_TO_FEATURE'),
        usageSource.indexOf('export function checkUsageLimit'),
    )
    const mapped = [...mapBlock.matchAll(/^\s+([a-z_]+)\s*:\s*'([a-zA-Z]+)'/gm)]
    const flagKeys = new Set(tierFeatureKeys())

    it('parsed the metric map', () => {
        expect(mapped.length).toBeGreaterThan(5)
    })

    for (const [, metric, flag] of mapped) {
        it(`metric "${metric}" targets an existing flag "${flag}"`, () => {
            expect(flagKeys.has(flag), `METRIC_TO_FEATURE.${metric} points at "${flag}", which is not a TIER_FEATURES key`).toBe(true)
        })
    }
})

describe('dead exports in the gating layer', () => {
    // canAccess() was exported, referenced only by its own tests, and read by
    // nothing in server/ — so a flag could be advertised, asserted in a parity
    // test, and never actually enforced. Either it is used or it goes.
    it('canAccess is either used in production code or removed', () => {
        const usedInProduction = corpus.includes('canAccess')
        const stillExported = /export function canAccess/.test(flagsSource)
        expect(
            !stillExported || usedInProduction,
            'canAccess() is exported from feature-flags.js but has no production consumer — delete it or wire it in, so it cannot look like a live gate.',
        ).toBe(true)
    })
})
