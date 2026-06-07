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
 * first array entry verbatim (e.g. "'200'", "true", "false").
 */
function comparisonFreeValue(label) {
    const idx = comparisonSource.indexOf(`feature: '${label}'`)
    if (idx === -1) return null
    const m = comparisonSource.slice(idx).match(/values:\s*\[\s*([^,\]]+)/)
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

    it('Free maxRepos=200 matches "200" on the Free pricing card', () => {
        const free = getFeatures('free')
        expect(free.maxRepos).toBe(200)
        const section = tierSection('Free')
        expect(section).toMatch(/Repositories managed[^}]*included:\s*'?200'?/)
    })

    it('Free aiQueriesPerMonth=200 matches "200" on the Free pricing card', () => {
        const free = getFeatures('free')
        expect(free.aiQueriesPerMonth).toBe(200)
        const section = tierSection('Free')
        expect(section).toMatch(/included:\s*'?200'?/)
    })

    it('Free apiKeys=5 matches "5" on the Free pricing card', () => {
        const free = getFeatures('free')
        expect(free.apiKeys).toBe(5)
        const section = tierSection('Free')
        expect(section).toMatch(/API keys[^}]*included:\s*'?5'?/)
    })

    it('Pro aiQueriesPerMonth=5000 matches "5,000" on the Pro pricing card', () => {
        const pro = getFeatures('pro')
        expect(pro.aiQueriesPerMonth).toBe(5000)
        const section = tierSection('Pro')
        // Page renders the formatted string with a thousands separator.
        expect(section).toMatch(/included:\s*'5,000'/)
    })

    it('Pro apiKeys=10 matches "10" on the Pro pricing card', () => {
        const pro = getFeatures('pro')
        expect(pro.apiKeys).toBe(10)
        const section = tierSection('Pro')
        expect(section).toMatch(/API keys[^}]*included:\s*'?10'?/)
    })

    it('Pro teamMembersMax=15 matches "15 members" copy on the Pro pricing card', () => {
        const pro = getFeatures('pro')
        expect(pro.teamMembersMax).toBe(15)
        const section = tierSection('Pro')
        expect(section).toMatch(/up to 15 members/i)
    })

    it('Enterprise apiKeys=50 matches "50" on the Enterprise pricing card', () => {
        const enterprise = getFeatures('enterprise')
        expect(enterprise.apiKeys).toBe(50)
        const section = tierSection('Enterprise')
        expect(section).toMatch(/API keys[^}]*included:\s*'?50'?/)
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
// unchecked — that is exactly how it drifted (50 repos / 2 keys / 50-mo
// search / 10-mo insights while flags moved to 200 / 5 / 75 / 15). These
// assertions tie every Free-column cell back to feature-flags so the table
// can no longer silently diverge.
// ---------------------------------------------------------------------------
describe('FeatureComparison.jsx ↔ feature-flags parity', () => {
    const free = getFeatures('free')

    it('Free repositories-managed cell matches maxRepos (200)', () => {
        expect(free.maxRepos).toBe(200)
        expect(comparisonFreeValue('Repositories managed')).toBe(`'${free.maxRepos}'`)
    })

    it('Free API-keys cell matches apiKeys (5)', () => {
        expect(free.apiKeys).toBe(5)
        expect(comparisonFreeValue('API keys')).toBe(`'${free.apiKeys}'`)
    })

    it('Free Semantic Search cell reflects semanticSearchPerMonth (75)', () => {
        expect(free.semanticSearchPerMonth).toBe(75)
        expect(comparisonFreeValue('Semantic Search')).toContain(String(free.semanticSearchPerMonth))
    })

    it('Free Repo Insights cell reflects repoInsightsPerMonth (15)', () => {
        expect(free.repoInsightsPerMonth).toBe(15)
        expect(comparisonFreeValue('Repo Insights / Quality Report')).toContain(String(free.repoInsightsPerMonth))
    })

    it('Free basic-bulk row is enabled (matches basicBulk)', () => {
        expect(free.basicBulk).toBe(true)
        expect(comparisonFreeValue('Basic bulk on own repos')).toBe('true')
    })

    it('Free advanced-bulk row is disabled (matches bulkAdvanced)', () => {
        expect(free.bulkAdvanced).toBe(false)
        expect(comparisonFreeValue('Advanced bulk (transfer, mirror, cross-org)')).toBe('false')
    })

    it('Free sync row is preview-only — apply (syncRepository) is Pro, preview (syncPreview) is free', () => {
        expect(free.syncRepository).toBe(false)
        expect(free.syncPreview).toBe(true)
        expect(comparisonFreeValue('Sync Repository (mirror sync)')).toBe("'Preview'")
    })

    it('Free audit-logs row is disabled (matches auditLog)', () => {
        expect(free.auditLog).toBe(false)
        expect(comparisonFreeValue('Audit Logs')).toBe('false')
    })

    it('Free team-collaboration row is ENABLED (matches teams) — never a bare false', () => {
        // Regression: this cell shipped as `false` while feature-flags has
        // teams:true (up to teamsMax/teamMembersMax) and PricingPage + README
        // both advertise Free teams. A bare `false` here is a pricing lie.
        expect(free.teams).toBe(true)
        const cell = comparisonFreeValue('Team collaboration')
        expect(cell).not.toBe('false')
        // Reflects the Free caps (teamsMax=3, teamMembersMax=5).
        expect(cell).toContain(String(free.teamsMax))
        expect(cell).toContain(String(free.teamMembersMax))
    })
})

// ---------------------------------------------------------------------------
// README pricing matrix is the THIRD pricing surface. It also went unchecked,
// which let the Free Semantic Search / Repo Insights caps drift AND let "AI
// Deep Review — walkthrough + comments + publish" be advertised Free while
// every deep-review.js endpoint is requireTier('pro').
// ---------------------------------------------------------------------------
describe('README pricing matrix ↔ feature-flags parity', () => {
    const free = getFeatures('free')

    it('Free repositories-managed cap matches flags (200)', () => {
        expect(readmeFreeCell('Repositories managed')).toBe(String(free.maxRepos))
    })

    it('Free API-keys cap matches flags (5)', () => {
        expect(readmeFreeCell('API keys')).toBe(String(free.apiKeys))
    })

    it('Free Semantic Search cap matches flags (75)', () => {
        expect(readmeFreeCell('Semantic Search')).toContain(String(free.semanticSearchPerMonth))
    })

    it('Free Repo Insights cap matches flags (15)', () => {
        expect(readmeFreeCell('Repo Insights / Quality Report')).toContain(String(free.repoInsightsPerMonth))
    })

    it('Deep Review walkthrough/comments/publish is NOT free (every endpoint is Pro-gated)', () => {
        // server/routes/ai/deep-review.js gates all 5 endpoints with requireTier('pro').
        expect(readmeFreeCell('AI Deep Review — walkthrough + comments + publish')).toBe('✗')
    })

    it('Basic bulk is free; advanced bulk is not', () => {
        expect(readmeFreeCell('Basic bulk on own repos')).toBe('✓')
        expect(readmeFreeCell('Advanced bulk (transfer, mirror, cross-org)')).toBe('✗')
    })

    it('Free Azure DevOps migration shows the metered cap (1 / month)', () => {
        expect(readmeFreeCell('Azure DevOps Cloud migration')).toBe('1 / month')
    })
})

// ---------------------------------------------------------------------------
// Migration metered-free: Free gets migrationFullPerMonth full (non-dry-run)
// migrations per month (dry-run stays unlimited). All three surfaces must
// reflect the same cap so the "1 / month" claim stays honest.
// ---------------------------------------------------------------------------
describe('Migration metered-free ↔ feature-flags parity', () => {
    it('Free migrationFullPerMonth is a finite metered cap (1); Pro/Enterprise unlimited', () => {
        expect(getFeatures('free').migrationFullPerMonth).toBe(1)
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
        expect(section).toMatch(/Azure DevOps Cloud migration[^}]*included:\s*'1 \/ month'/)
    })
})

// ---------------------------------------------------------------------------
// Sync preview-free: Free gets a read-only sync PREVIEW (syncPreview), while
// the destructive apply (syncRepository) stays Pro. All surfaces must show the
// "Preview" capability for Free, not a flat ✗.
// ---------------------------------------------------------------------------
describe('Sync preview-free ↔ feature-flags parity', () => {
    it('Free has sync preview but not apply', () => {
        expect(getFeatures('free').syncPreview).toBe(true)
        expect(getFeatures('free').syncRepository).toBe(false)
    })

    it('Pro/Enterprise have both preview and apply', () => {
        for (const tier of ['pro', 'enterprise']) {
            expect(getFeatures(tier).syncPreview).toBe(true)
            expect(getFeatures(tier).syncRepository).toBe(true)
        }
    })

    it('README Mirror Sync row shows preview-only on Free', () => {
        expect(readmeFreeCell('Mirror Sync (preview free, apply Pro)')).toBe('Preview')
    })
})
