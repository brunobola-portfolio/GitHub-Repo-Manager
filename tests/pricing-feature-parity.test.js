// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

import { getFeatures } from '../server/lib/feature-flags.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pricingSource = readFileSync(
    join(__dirname, '..', 'src', 'components', 'Pricing', 'PricingPage.jsx'),
    'utf-8',
)

/**
 * Naive section-finder: returns the literal text between `tier: 'Foo'` and the
 * next `tier:` (or end of file). Good enough to localise number assertions per
 * pricing card.
 */
function tierSection(label) {
    const start = pricingSource.indexOf(`tier: '${label}'`)
    if (start === -1) return ''
    const next = pricingSource.indexOf('tier:', start + 1)
    return pricingSource.slice(start, next === -1 ? undefined : next)
}

const comparisonSource = readFileSync(
    join(__dirname, '..', 'src', 'components', 'Pricing', 'FeatureComparison.jsx'),
    'utf-8',
)

// PricingPreview.jsx is the FOURTH pricing surface — the first one a prospect
// sees on the landing page. It was never wired into this gate, which let its
// Free caps drift (50 repos / 50 searches) below the real flags (200 / 75).
const previewSource = readFileSync(
    join(__dirname, '..', 'src', 'components', 'Landing', 'PricingPreview.jsx'),
    'utf-8',
)

// LicensePlanSection.jsx is the FIFTH pricing surface — the in-app Settings
// upsell. It drifted to a fictional "10,000 AI queries/month" + non-Pro
// deliverables ("Priority support", "Advanced analytics"); wire it in so the
// Pro upsell copy can never diverge from feature-flags again.
const licenseSource = readFileSync(
    join(__dirname, '..', 'src', 'components', 'Settings', 'LicensePlanSection.jsx'),
    'utf-8',
)

// billing.js is the source of truth for whether a Stripe free trial actually
// exists — used to keep "free trial" marketing copy honest.
const billingSource = readFileSync(
    join(__dirname, '..', 'server', 'routes', 'billing.js'),
    'utf-8',
)

const readmeFull = readFileSync(join(__dirname, '..', 'README.md'), 'utf-8')
// Scope README matrix assertions to the "## Plans & Pricing" section so a
// like-named row in another table can't satisfy them.
const pricingSectionStart = readmeFull.indexOf('## Plans & Pricing')
const pricingSectionEnd = readmeFull.indexOf('\n## ', pricingSectionStart + 1)
const pricingMatrix = readmeFull.slice(
    pricingSectionStart,
    pricingSectionEnd === -1 ? undefined : pricingSectionEnd,
)

/**
 * Extract the Free-column value for a feature row in FeatureComparison.jsx.
 * Rows look like `{ feature: 'X', values: [free, pro, ent] }`; returns the
 * first array entry verbatim (e.g. "'1,000'", "true", "false"). The quoted-
 * string branch is tried first so thousands-separator commas inside a value
 * (e.g. '1,000') aren't mistaken for the array-element separator.
 */
function comparisonFreeValue(label) {
    const idx = comparisonSource.indexOf(`feature: '${label}'`)
    if (idx === -1) return null
    const m = comparisonSource.slice(idx).match(/values:\s*\[\s*('(?:[^'\\]|\\.)*'|[^,\]]+)/)
    return m ? m[1].trim() : null
}

/**
 * Extract the Free (first data) cell of a README pricing-matrix row by its
 * feature label. Returns the trimmed cell text (e.g. "200", "75 / month", "✗").
 */
function readmeFreeCell(label) {
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const m = pricingMatrix.match(new RegExp(`\\|\\s*${esc}\\s*\\|\\s*([^|]+?)\\s*\\|`))
    return m ? m[1].trim() : null
}

describe('Pricing page ↔ feature-flags parity', () => {
    it('exposes Free/Pro/Enterprise pricing cards', () => {
        const tierLabels = ['Free', 'Pro', 'Enterprise']
        for (const label of tierLabels) {
            expect(pricingSource).toContain(`tier: '${label}'`)
        }
        // feature-flags.js must define a config for each tier
        for (const tier of ['free', 'pro', 'enterprise']) {
            expect(getFeatures(tier)).toBeTruthy()
        }
    })

    // Retracted 2026-07-27: repos_managed was never incremented and maxRepos
    // never checked, so the advertised 1,000 ceiling did not exist. Every tier
    // now says Unlimited, which is what the code has always done.
    it('Free maxRepos is unlimited and the Free pricing card says so', () => {
        const free = getFeatures('free')
        expect(free.maxRepos).toBe(Infinity)
        const section = tierSection('Free')
        expect(section).toMatch(/Repositories managed[^}]*included:\s*'Unlimited'/)
    })

    it('Free aiQueriesPerMonth=1000 matches "1,000" on the Free pricing card', () => {
        const free = getFeatures('free')
        expect(free.aiQueriesPerMonth).toBe(1000)
        const section = tierSection('Free')
        expect(section).toMatch(/AI queries \/ month \(total\)[^}]*included:\s*'1,000'/)
    })

    it('Free apiKeys=25 matches "25" on the Free pricing card', () => {
        const free = getFeatures('free')
        expect(free.apiKeys).toBe(25)
        const section = tierSection('Free')
        expect(section).toMatch(/API keys[^}]*included:\s*'?25'?/)
    })

    it('Free bulkAdvanced/syncRepository are true and advertised as Free bullets', () => {
        const free = getFeatures('free')
        expect(free.bulkAdvanced).toBe(true)
        expect(free.syncRepository).toBe(true)
        const section = tierSection('Free')
        expect(section).toMatch(/Bulk ops incl\. transfer, mirror, cross-org/)
        expect(section).toMatch(/Mirror Sync \(apply\)/)
    })

    it('Free deepReviewPerMonth=10 / prChatMessagesPerMonth=100 / prCommandPerMonth=30 are advertised as Free bullets', () => {
        const free = getFeatures('free')
        expect(free.deepReviewPerMonth).toBe(10)
        expect(free.prChatMessagesPerMonth).toBe(100)
        expect(free.prCommandPerMonth).toBe(30)
        const section = tierSection('Free')
        expect(section).toMatch(/AI Deep Review[^}]*included:\s*'10 \/ month'/)
        expect(section).toMatch(/PR Chat[^}]*included:\s*'100 messages \/ month'/)
        expect(section).toMatch(/PR slash commands[^}]*included:\s*'30 \/ month'/)
    })

    it('Pro aiQueriesPerMonth=10000 matches "10,000" on the Pro pricing card', () => {
        const pro = getFeatures('pro')
        expect(pro.aiQueriesPerMonth).toBe(10000)
        const section = tierSection('Pro')
        // Page renders the formatted string with a thousands separator.
        expect(section).toMatch(/included:\s*'10,000'/)
    })

    it('Pro apiKeys=50 matches "50" on the Pro pricing card', () => {
        const pro = getFeatures('pro')
        expect(pro.apiKeys).toBe(50)
        const section = tierSection('Pro')
        expect(section).toMatch(/API keys[^}]*included:\s*'?50'?/)
    })

    it('Pro teamMembersMax=Infinity matches "unlimited" team copy on the Pro pricing card', () => {
        const pro = getFeatures('pro')
        expect(pro.teamMembersMax).toBe(Infinity)
        const section = tierSection('Pro')
        expect(section).toMatch(/Teams.*unlimited/i)
    })

    it('Enterprise apiKeys=100 matches "100" on the Enterprise pricing card', () => {
        const enterprise = getFeatures('enterprise')
        expect(enterprise.apiKeys).toBe(100)
        const section = tierSection('Enterprise')
        expect(section).toMatch(/API keys[^}]*included:\s*'?100'?/)
    })

    it('Enterprise team-members copy reflects unlimited tier', () => {
        const enterprise = getFeatures('enterprise')
        expect(enterprise.teamMembersMax).toBe(Infinity)
        const section = tierSection('Enterprise')
        expect(section).toMatch(/Unlimited team members/i)
    })

    it('Free semanticSearch=true — present on Free tier (capped)', () => {
        const free = getFeatures('free')
        expect(free.semanticSearch).toBe(true)
        const section = tierSection('Free')
        expect(section).toMatch(/Semantic Search/i)
    })

    it('Pro semanticSearch=true with unlimited per-feature cap', () => {
        const pro = getFeatures('pro')
        expect(pro.semanticSearch).toBe(true)
        expect(pro.semanticSearchPerMonth).toBe(Infinity)
    })
})

// ---------------------------------------------------------------------------
// FeatureComparison.jsx is the SECOND pricing surface and was previously
// unchecked — that is exactly how it drifted. These assertions tie every
// Free-column cell back to feature-flags so the table can no longer silently
// diverge. Updated 2026-07-18 for the "nearly everything free" rebalance
// (.dev/prod-premium/2026-07-17/design-pricing-rebalance.md §2).
// ---------------------------------------------------------------------------
describe('FeatureComparison.jsx ↔ feature-flags parity', () => {
    const free = getFeatures('free')

    it('Free repositories-managed cell says Unlimited, matching maxRepos', () => {
        expect(free.maxRepos).toBe(Infinity)
        expect(comparisonFreeValue('Repositories managed')).toBe("'Unlimited'")
    })

    it('Free API-keys cell matches apiKeys (25)', () => {
        expect(free.apiKeys).toBe(25)
        expect(comparisonFreeValue('API keys')).toBe(`'${free.apiKeys}'`)
    })

    it('Free Semantic Search cell reflects semanticSearchPerMonth (375)', () => {
        expect(free.semanticSearchPerMonth).toBe(375)
        expect(comparisonFreeValue('Semantic Search')).toContain(String(free.semanticSearchPerMonth))
    })

    it('Free Repo Insights cell reflects repoInsightsPerMonth (75)', () => {
        expect(free.repoInsightsPerMonth).toBe(75)
        expect(comparisonFreeValue('Repo Insights / Quality Report')).toContain(String(free.repoInsightsPerMonth))
    })

    it('Free basic-bulk row is enabled (matches basicBulk)', () => {
        expect(free.basicBulk).toBe(true)
        expect(comparisonFreeValue('Basic bulk on own repos')).toBe('true')
    })

    it('Free advanced-bulk row is ENABLED (matches bulkAdvanced — moved to Free 2026-07-18)', () => {
        // Inversion: bulk transfer/mirror/delete moved off the Pro paywall.
        // Safety is the existing dry-run + confirmation-token flow plus the
        // new tier-independent bulkDestructiveDailyMax ceiling, not tier.
        expect(free.bulkAdvanced).toBe(true)
        expect(comparisonFreeValue('Advanced bulk (transfer, mirror, cross-org)')).toBe('true')
    })

    it('Free sync row now shows the metered apply cap (syncRepository moved to Free)', () => {
        // Inversion: apply (clone + force-push) is free on every tier now,
        // newly metered against syncApplyPerMonth.
        expect(free.syncRepository).toBe(true)
        expect(free.syncPreview).toBe(true)
        expect(free.syncApplyPerMonth).toBe(10)
        expect(comparisonFreeValue('Sync Repository (mirror sync)')).toBe(`'${free.syncApplyPerMonth} / month'`)
    })

    it('Free audit-logs row is disabled (matches auditLog)', () => {
        expect(free.auditLog).toBe(false)
        expect(comparisonFreeValue('Audit Logs')).toBe('false')
    })

    it('Free team-collaboration row is Unlimited (matches teamsMax/teamMembersMax = Infinity)', () => {
        // teamsMax/teamMembersMax flipped to Infinity 2026-07-18, dissolving
        // the seat-billing honesty gap — no more tiered-team-size claim.
        expect(free.teams).toBe(true)
        expect(free.teamsMax).toBe(Infinity)
        expect(free.teamMembersMax).toBe(Infinity)
        expect(comparisonFreeValue('Team collaboration')).toBe("'Unlimited'")
    })

    it('Free PR-review row is NOT "Read-only" — write-back is free on every tier (prReview:true)', () => {
        // prReview is true for all tiers and the write-back endpoints are
        // available on Free (server/__tests__/pr-write-tier-gate.test.js), and
        // PricingPage lists "PR Review with write-back comments" for Free. A
        // "Read-only" cell here contradicts all three.
        expect(free.prReview).toBe(true)
        const cell = comparisonFreeValue('PR Review Experience')
        expect(cell).not.toBe("'Read-only'")
    })

    // ── New rows added 2026-07-18: Deep Review, Prompt Studio, PR Chat, PR
    // Commands moved off the Pro paywall to Free with their own monthly caps.
    it('Free Deep Review cell reflects deepReviewPerMonth (10)', () => {
        expect(free.deepReviewPerMonth).toBe(10)
        expect(comparisonFreeValue('AI Deep Review (walkthrough + comments + publish)')).toContain(String(free.deepReviewPerMonth))
    })

    it('Free Prompt Studio cell reflects promptPresetsMax (10) and promptStudioTestPerMonth (30)', () => {
        expect(free.promptPresetsMax).toBe(10)
        expect(free.promptStudioTestPerMonth).toBe(30)
        const cell = comparisonFreeValue('Prompt Studio (custom presets + test runs)')
        expect(cell).toContain(String(free.promptPresetsMax))
        expect(cell).toContain(String(free.promptStudioTestPerMonth))
    })

    it('Free PR Chat cell reflects prChatMessagesPerMonth (100)', () => {
        expect(free.prChatMessagesPerMonth).toBe(100)
        expect(comparisonFreeValue('PR Chat (streaming Q&A)')).toContain(String(free.prChatMessagesPerMonth))
    })

    it('Free PR Commands cell reflects prCommandPerMonth (30)', () => {
        expect(free.prCommandPerMonth).toBe(30)
        expect(comparisonFreeValue('PR slash commands (/describe, /test_plan, /improve)')).toContain(String(free.prCommandPerMonth))
    })

    it('DORA metrics row is Free/Pro/Enterprise true — no requireTier gate remains in work-board.js', () => {
        // DORA metrics have no feature-flags.js key (pure read-only git-history
        // aggregation with no AI/marginal cost) — the row is checked against
        // the literal table value, not a getFeatures() flag.
        expect(comparisonFreeValue('DORA metrics (deploy frequency, lead time, change failure rate, MTTR)')).toBe('true')
    })

    // White-glove migration services and Priority support are manual,
    // service-based deliverables (support ticket + contract) — they have no
    // feature-flags.js key, unlike every other row in this suite. Exempted
    // from flag-backed parity by design (see design doc §4 "Keeping the
    // parity gate honest about non-code items"); asserted against the
    // literal Enterprise-only cell value instead.
    it('White-glove migration services is Enterprise-only (no feature-flags key — manual service)', () => {
        expect(comparisonFreeValue('White-glove migration services')).toBe('false')
    })

    it('Priority support is Enterprise-only (no feature-flags key — manual service)', () => {
        expect(comparisonFreeValue('Priority support')).toBe('false')
    })
})

// ---------------------------------------------------------------------------
// Wave 6 "Community WOW" (2026-07-18): four new metered AI features
// (README Studio improve reuses readmeGenPerMonth — no new key; AI Diagram
// Generator, Agent Rules Generator, Security Posture AI Summary, and AI Image
// Generation each got a brand-new TIER_FEATURES cap). Tie all five to every
// pricing surface so a future silent cap drift can't pass CI undetected, the
// same way the rest of this file protects the pre-wave-6 features.
// ---------------------------------------------------------------------------
describe('Wave 6 features ↔ feature-flags parity', () => {
    const free = getFeatures('free')
    const pro = getFeatures('pro')
    const enterprise = getFeatures('enterprise')

    it('Free diagramGenPerMonth=15 / agentRulesPerMonth=20 / securityPostureAIPerMonth=75 / imageGenPerMonth=5', () => {
        expect(free.diagramGenPerMonth).toBe(15)
        expect(free.agentRulesPerMonth).toBe(20)
        expect(free.securityPostureAIPerMonth).toBe(75)
        expect(free.imageGenPerMonth).toBe(5)
    })

    it('Pro/Enterprise are unlimited on all four new wave-6 caps', () => {
        for (const tier of [pro, enterprise]) {
            expect(tier.diagramGenPerMonth).toBe(Infinity)
            expect(tier.agentRulesPerMonth).toBe(Infinity)
            expect(tier.securityPostureAIPerMonth).toBe(Infinity)
            expect(tier.imageGenPerMonth).toBe(Infinity)
        }
    })

    it('FeatureComparison Free cells reflect the four new caps', () => {
        expect(comparisonFreeValue('AI Diagram Generator')).toContain(String(free.diagramGenPerMonth))
        expect(comparisonFreeValue('Agent Rules Generator (AGENTS.md / CLAUDE.md)')).toContain(String(free.agentRulesPerMonth))
        expect(comparisonFreeValue('Security Posture AI Summary')).toContain(String(free.securityPostureAIPerMonth))
        expect(comparisonFreeValue('AI Image Generation (social / hero / logo)')).toContain(String(free.imageGenPerMonth))
    })

    it('FeatureComparison README Studio cell reuses readmeGenPerMonth (no new key)', () => {
        expect(comparisonFreeValue('README Studio (AI improve)')).toContain(String(free.readmeGenPerMonth))
    })

    it('README pricing matrix cells reflect the four new caps', () => {
        expect(readmeFreeCell('AI Diagram Generator')).toContain(String(free.diagramGenPerMonth))
        expect(readmeFreeCell('Agent Rules Generator (AGENTS.md / CLAUDE.md)')).toContain(String(free.agentRulesPerMonth))
        expect(readmeFreeCell('Security Posture AI Summary')).toContain(String(free.securityPostureAIPerMonth))
        expect(readmeFreeCell('AI Image Generation (social / hero / logo)')).toContain(String(free.imageGenPerMonth))
    })

    it('README pricing matrix README Studio row reuses readmeGenPerMonth (no new key)', () => {
        expect(readmeFreeCell('README Studio (AI improve)')).toContain(String(free.readmeGenPerMonth))
    })

    it('PricingPage Free card advertises all five wave-6 rows', () => {
        const section = tierSection('Free')
        expect(section).toMatch(/README Studio \(AI improve\)[^}]*included:\s*'25 \/ month'/)
        expect(section).toMatch(/AI Diagram Generator[^}]*included:\s*'15 \/ month'/)
        expect(section).toMatch(/Agent Rules Generator \(AGENTS\.md \/ CLAUDE\.md\)[^}]*included:\s*'20 \/ month'/)
        expect(section).toMatch(/Security Posture AI Summary[^}]*included:\s*'75 \/ month'/)
        expect(section).toMatch(/AI Image Generation \(social \/ hero \/ logo\)[^}]*included:\s*'5 \/ month'/)
    })
})

// ---------------------------------------------------------------------------
// PricingPreview.jsx (Landing) is the FOURTH pricing surface and the first a
// prospect sees. Tie its Free caps back to feature-flags so it can't drift.
// ---------------------------------------------------------------------------
describe('PricingPreview.jsx (Landing) ↔ feature-flags parity', () => {
    const free = getFeatures('free')

    it('the landing preview claims no repository ceiling on any tier', () => {
        expect(free.maxRepos).toBe(Infinity)
        expect(previewSource).not.toMatch(/Up to [\d,]+ repositories/)
        // "Unlimited repositories" was the Pro card's lead bullet; with no
        // ceiling anywhere it is not a differentiator and must not be sold.
        expect(previewSource).not.toMatch(/Unlimited repositories/)
    })

    it('Free Semantic Search line matches semanticSearchPerMonth (375, not the stale 75)', () => {
        expect(free.semanticSearchPerMonth).toBe(375)
        expect(previewSource).toMatch(new RegExp(`Semantic Search \\(${free.semanticSearchPerMonth} / month\\)`))
    })

    it('Free preview no longer implies bulk/sync are Pro-exclusive', () => {
        expect(free.bulkAdvanced).toBe(true)
        expect(free.syncRepository).toBe(true)
        expect(previewSource).toMatch(/Bulk ops.*Mirror Sync/)
    })
})

// ---------------------------------------------------------------------------
// LicensePlanSection.jsx (Settings upsell) is the FIFTH pricing surface. Its
// Pro upsell bullet list must match feature-flags (pro) — no fictional caps,
// no non-Pro deliverables.
// ---------------------------------------------------------------------------
describe('LicensePlanSection.jsx (Settings upsell) ↔ feature-flags parity', () => {
    const pro = getFeatures('pro')
    const free = getFeatures('free')

    // The Pro upsell renders `{[...bullets].map(...)}` right after the
    // "For teams" subtitle. Grab that literal array so assertions are scoped
    // to the Pro card and can't be satisfied by the Enterprise list.
    function proUpsellArray() {
        const anchor = licenseSource.indexOf('For teams')
        const mapIdx = licenseSource.indexOf('].map(', anchor)
        const arrStart = licenseSource.lastIndexOf('[', mapIdx)
        return licenseSource.slice(arrStart, mapIdx + 1)
    }

    it('Pro AI-queries bullet matches aiQueriesPerMonth (10,000 — not the stale 5,000)', () => {
        expect(pro.aiQueriesPerMonth).toBe(10000)
        const list = proUpsellArray()
        expect(list).toContain(pro.aiQueriesPerMonth.toLocaleString('en-US')) // "10,000"
        expect(list).not.toMatch(/5,000/)
    })

    it('Pro upsell reflects the higher API-key ceiling (50 — not the stale 10)', () => {
        expect(pro.apiKeys).toBe(50)
        expect(proUpsellArray()).toContain(String(pro.apiKeys))
    })

    it('Pro upsell no longer claims bulk/sync/repos as Pro-exclusive (Free already has them)', () => {
        // bulkAdvanced/syncRepository/maxRepos-generosity moved to Free
        // 2026-07-18 — Pro's real differentiators are AI headroom, $
        // spend-cap headroom, API keys, and email support (see design doc §1
        // "Pro's role shrinks").
        expect(free.bulkAdvanced).toBe(true)
        expect(free.syncRepository).toBe(true)
        const list = proUpsellArray()
        expect(list).not.toMatch(/Unlimited repositories/i)
        expect(list).not.toMatch(/Advanced bulk/i)
        expect(list).not.toMatch(/mirror sync/i)
    })

    it('Pro upsell does not claim non-Pro deliverables (Priority support / Advanced analytics)', () => {
        const list = proUpsellArray()
        // "Priority support" is an Enterprise deliverable; Pro is "Email support".
        expect(list).not.toMatch(/Priority support/i)
        // "Advanced analytics" is a roadmap Enterprise item, not a Pro feature.
        expect(list).not.toMatch(/Advanced analytics/i)
    })

    it('does not leave "N/A" placeholders in the panel (uses an em dash)', () => {
        expect(licenseSource).not.toMatch(/'N\/A'/)
    })
})

// ---------------------------------------------------------------------------
// Honesty: don't advertise a "free trial" the checkout never grants. The Stripe
// session in billing.js must actually set trial_period_days before any pricing
// surface may claim a trial.
// ---------------------------------------------------------------------------
describe('Free-trial copy ↔ Stripe checkout reality', () => {
    const stripeImplementsTrial = /trial_period_days/.test(billingSource)

    it('no pricing surface claims an N-day free trial unless Stripe actually grants one', () => {
        if (stripeImplementsTrial) return // trial is real — copy is allowed
        // The dishonest claim is an affirmative "14-day free trial" (a CTA or a
        // statement). A FAQ *question* ("Do you offer a free trial?") and the
        // Free tier's honest "no credit card required" are both fine.
        expect(pricingSource, 'PricingPage must not claim an N-day free trial').not.toMatch(/\d+[-\s]?day free trial/i)
        expect(previewSource, 'PricingPreview must not advertise a free trial').not.toMatch(/free trial/i)
    })
})

// ---------------------------------------------------------------------------
// README pricing matrix is the THIRD pricing surface. It also went unchecked,
// which let the Free Semantic Search / Repo Insights caps drift. Updated
// 2026-07-18 for the "nearly everything free" rebalance — Deep Review /
// Prompt Studio / PR Chat / PR Commands flip from ✗ to their new metered Free
// values, since every corresponding route dropped its requireTier('pro') gate.
// ---------------------------------------------------------------------------
describe('README pricing matrix ↔ feature-flags parity', () => {
    const free = getFeatures('free')

    it('Free repositories-managed cap matches flags (unlimited)', () => {
        expect(free.maxRepos).toBe(Infinity)
        expect(readmeFreeCell('Repositories managed')).toBe('Unlimited')
    })

    it('Free API-keys cap matches flags (25)', () => {
        expect(readmeFreeCell('API keys')).toBe(String(free.apiKeys))
    })

    it('Free Semantic Search cap matches flags (375)', () => {
        expect(readmeFreeCell('Semantic Search')).toContain(String(free.semanticSearchPerMonth))
    })

    it('Free Repo Insights cap matches flags (75)', () => {
        expect(readmeFreeCell('Repo Insights / Quality Report')).toContain(String(free.repoInsightsPerMonth))
    })

    it('Deep Review walkthrough/comments/publish IS free — metered at deepReviewPerMonth (10)', () => {
        // server/routes/ai/deep-review.js dropped requireTier('pro') from all
        // 5 endpoints 2026-07-18; now gated by checkAIFeatureLimit only.
        expect(free.deepReviewPerMonth).toBe(10)
        expect(readmeFreeCell('AI Deep Review — walkthrough + comments + publish')).toBe('10 / month')
    })

    it('Prompt Studio is free — metered at promptPresetsMax (10) / promptStudioTestPerMonth (30)', () => {
        expect(free.promptPresetsMax).toBe(10)
        expect(free.promptStudioTestPerMonth).toBe(30)
        const cell = readmeFreeCell('AI Deep Review — Prompt Studio (custom presets, path rules, severity floor)')
        expect(cell).toContain(String(free.promptPresetsMax))
        expect(cell).toContain(String(free.promptStudioTestPerMonth))
    })

    it('Org-shared prompts is free — no requireTier gate remains in prompt-studio.js', () => {
        expect(readmeFreeCell('AI Deep Review — org-shared prompts')).toBe('✓')
    })

    it('PR slash commands is free — metered at prCommandPerMonth (30)', () => {
        expect(free.prCommandPerMonth).toBe(30)
        expect(readmeFreeCell('AI Deep Review — PR slash commands (`/describe`, `/test_plan`, `/improve`)')).toBe('30 / month')
    })

    it('PR Chat is free — metered at prChatMessagesPerMonth (100)', () => {
        expect(free.prChatMessagesPerMonth).toBe(100)
        expect(readmeFreeCell('AI Deep Review — PR Chat (streaming Q&A)')).toBe('100 messages / month')
    })

    it('Basic bulk is free; advanced bulk is ALSO free (moved 2026-07-18)', () => {
        expect(readmeFreeCell('Basic bulk on own repos')).toBe('✓')
        expect(readmeFreeCell('Advanced bulk (transfer, mirror, cross-org)')).toBe('✓')
    })

    it('Free Azure DevOps migration shows the metered cap (5 / month)', () => {
        expect(free.migrationFullPerMonth).toBe(5)
        expect(readmeFreeCell('Azure DevOps Cloud migration')).toBe('5 / month')
    })

    it('White-glove migration services is Enterprise-only in the README table too', () => {
        // No feature-flags key — manual service deliverable (see the
        // FeatureComparison suite above for the same exemption rationale).
        expect(readmeFreeCell('White-glove migration services')).toBe('✗')
    })
})

// ---------------------------------------------------------------------------
// Migration metered-free: Free gets migrationFullPerMonth full (non-dry-run)
// migrations per month (dry-run stays unlimited). All three surfaces must
// reflect the same cap so the "5 / month" claim stays honest.
// ---------------------------------------------------------------------------
describe('Migration metered-free ↔ feature-flags parity', () => {
    it('Free migrationFullPerMonth is a finite metered cap (5); Pro/Enterprise unlimited', () => {
        expect(getFeatures('free').migrationFullPerMonth).toBe(5)
        expect(getFeatures('pro').migrationFullPerMonth).toBe(Infinity)
        expect(getFeatures('enterprise').migrationFullPerMonth).toBe(Infinity)
    })

    it('Free migration flag is "metered" (not the old dry-run-only gate)', () => {
        expect(getFeatures('free').migration).toBe('metered')
    })

    it('FeatureComparison Free Azure migration reflects the cap', () => {
        expect(comparisonFreeValue('Azure DevOps Cloud migration')).toContain(String(getFeatures('free').migrationFullPerMonth))
    })

    it('PricingPage Free card advertises the metered migration row', () => {
        const section = tierSection('Free')
        expect(section).toMatch(/Azure DevOps Cloud migration[^}]*included:\s*'5 \/ month'/)
    })
})

// ---------------------------------------------------------------------------
// Sync apply metered-free: syncRepository (apply) moved off the Pro paywall
// to Free 2026-07-18, newly metered against syncApplyPerMonth — mirroring the
// migrationFullPerMonth pattern. syncPreview was already free and unchanged.
// ---------------------------------------------------------------------------
describe('Sync apply metered-free ↔ feature-flags parity', () => {
    it('Free has both sync preview and metered apply', () => {
        expect(getFeatures('free').syncPreview).toBe(true)
        expect(getFeatures('free').syncRepository).toBe(true)
        expect(getFeatures('free').syncApplyPerMonth).toBe(10)
    })

    it('Pro/Enterprise have unlimited preview and apply', () => {
        for (const tier of ['pro', 'enterprise']) {
            expect(getFeatures(tier).syncPreview).toBe(true)
            expect(getFeatures(tier).syncRepository).toBe(true)
            expect(getFeatures(tier).syncApplyPerMonth).toBe(Infinity)
        }
    })

    it('README Mirror Sync row shows the metered Free apply cap', () => {
        expect(readmeFreeCell('Mirror Sync (preview free, apply metered)')).toBe('10 / month')
    })

    it('FeatureComparison Mirror Sync row shows the metered Free apply cap', () => {
        expect(comparisonFreeValue('Sync Repository (mirror sync)')).toBe("'10 / month'")
    })
})

describe('spend cap is never sold as a paid differentiator while it ships disabled', () => {
    const tiers = ['free', 'pro', 'enterprise']

    it('aiSpendCapCents is identical across tiers (so there is no headroom to sell)', () => {
        const values = tiers.map((t) => getFeatures(t).aiSpendCapCents)
        expect(new Set(values).size).toBe(1)
    })

    it('no pricing surface claims spend-cap headroom', () => {
        for (const src of [pricingSource, comparisonSource, previewSource]) {
            expect(src).not.toMatch(/spend[- ]cap headroom/i)
        }
    })
})

// ---------------------------------------------------------------------------
// Cross-surface Pro claims.
//
// The Pro-upsell checks above scope themselves to LicensePlanSection's bullet
// array, which is exactly why "priority support for power users" survived on
// the landing page for so long: it sat in PricingPreview's Pro *description*,
// outside every scoped assertion. A promise is either true on all five pricing
// surfaces or it is not true — so check them together.
// ---------------------------------------------------------------------------
describe('Enterprise-only deliverables never appear in a Pro context', () => {
    // Deliberately narrow: the phrase, plus enough context that it can only
    // match a claim about Pro. Enterprise entries mentioning the same phrase
    // are correct and must keep passing.
    const SURFACES = [
        ['PricingPreview.jsx', previewSource, "name: 'Pro'", "name: 'Enterprise'"],
        ['PricingPage.jsx', pricingSource, "tier: 'Pro'", "tier: 'Enterprise'"],
    ]

    const ENTERPRISE_ONLY = [/priority support/i, /advanced analytics/i, /\bSLA\b/]

    // Strip comments before matching: the gate is about what the page CLAIMS,
    // which lives in the strings. A comment explaining why a phrase is absent
    // must not be read as the phrase being present.
    const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

    for (const [name, src, startMarker, endMarker] of SURFACES) {
        it(`${name} does not sell Pro with an Enterprise-only deliverable`, () => {
            const start = src.indexOf(startMarker)
            const end = src.indexOf(endMarker)
            expect(start, `could not locate the Pro block in ${name}`).toBeGreaterThan(-1)
            expect(end, `could not locate the Enterprise block in ${name}`).toBeGreaterThan(start)

            const proBlock = stripComments(src.slice(start, end))
            const offenders = ENTERPRISE_ONLY.filter((re) => re.test(proBlock)).map(String)
            expect(offenders, `${name} promises Pro something only Enterprise ships`).toEqual([])
        })
    }
})

// ---------------------------------------------------------------------------
// "Repo Advisor" names two surfaces with two different meters, and the FAQ
// described only one of them.
//
// The floating conversational assistant is POST /api/ai/chat and does
// increment ai_queries. The Repo Advisor card inside the Work Board is
// POST /work-board/ai/interpret, metered by requireWorkBoardAI against the
// per-user ai_monthly_cap_cents in work_board_prefs — its own ledger, which
// never touches the monthly query total the FAQ promises to charge it to.
// ---------------------------------------------------------------------------
describe('PricingPage FAQ — the AI-query answer covers both Repo Advisor meters', () => {
    function aiQueryAnswer() {
        const idx = pricingSource.indexOf('What counts as an AI query?')
        expect(idx, 'the FAQ entry moved — re-point this gate').toBeGreaterThan(-1)
        return pricingSource.slice(idx, idx + 1400)
    }

    it('does not claim every Repo Advisor call counts against the monthly total', () => {
        const answer = aiQueryAnswer()
        // Naming Repo Advisor is fine; naming it without qualifying the Work
        // Board surface is the false part.
        if (/Repo Advisor/.test(answer)) {
            expect(answer, 'the Work Board card is metered separately and the answer must say so')
                .toMatch(/Work Board/)
        }
    })

    it('points the reader at the separate Work Board cap', () => {
        expect(aiQueryAnswer()).toMatch(/separately|own (spend )?cap/i)
    })
})
