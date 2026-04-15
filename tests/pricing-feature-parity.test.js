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

    it('Free maxRepos=50 matches "50" on the Free pricing card', () => {
        const free = getFeatures('free')
        expect(free.maxRepos).toBe(50)
        const section = tierSection('Free')
        expect(section).toMatch(/included:\s*'?50'?/)
    })

    it('Free aiQueriesPerMonth=200 matches "200" on the Free pricing card', () => {
        const free = getFeatures('free')
        expect(free.aiQueriesPerMonth).toBe(200)
        const section = tierSection('Free')
        expect(section).toMatch(/included:\s*'?200'?/)
    })

    it('Free apiKeys=2 matches "2" on the Free pricing card', () => {
        const free = getFeatures('free')
        expect(free.apiKeys).toBe(2)
        const section = tierSection('Free')
        expect(section).toMatch(/API keys[^}]*included:\s*'?2'?/)
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
