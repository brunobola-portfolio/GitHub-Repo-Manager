// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function readSource(...parts) {
    return readFileSync(join(__dirname, '..', ...parts), 'utf-8')
}

/*
 * Regression guard for a dead-CTA bug: the router only ever registered the
 * `#/pricing` hash (src/hooks/useAppRouter.js HASH_ROUTES / VIEW_TO_HASH) and
 * silently no-ops on any other hash. Three call sites used to hardcode the
 * bare `#pricing` fragment instead — the sole upgrade CTA on several
 * tier-gated surfaces (UpgradeRequired, FeatureState) plus a toast action
 * (ToastProvider's 'open-pricing' dispatch) did nothing when clicked.
 *
 * This scans exactly those three known offenders (not a repo-wide sweep —
 * see the brief) so this specific class of regression fails CI immediately
 * if a future edit reintroduces the bare fragment, rather than shipping a
 * silently dead monetization CTA again.
 *
 * Word-boundary note: `/#pricing\b/` matches the dead bare fragment but NOT
 * `#/pricing` — the character right after `#` there is `/`, not `p`.
 */
describe('pricing CTA hash regression guard', () => {
    it('UpgradeRequired.jsx defaults pricingHref to the registered #/pricing hash', () => {
        const source = readSource('src', 'components', 'states', 'UpgradeRequired.jsx')
        expect(source).not.toMatch(/#pricing\b/)
        expect(source).toContain('#/pricing')
    })

    it('FeatureState.jsx defaults pricingHref to the registered #/pricing hash', () => {
        const source = readSource('src', 'components', 'states', 'FeatureState.jsx')
        expect(source).not.toMatch(/#pricing\b/)
        expect(source).toContain('#/pricing')
    })

    it('ToastProvider.jsx routes the open-pricing action through the app event bus, not a direct hash mutation', () => {
        const source = readSource('src', 'contexts', 'ToastProvider.jsx')
        // Never the dead bare fragment, and never a direct window.location.hash
        // write for pricing (the hash-mutation anti-pattern this bug came from —
        // see src/hooks/useAppEventBridge.js's comment on the same anti-pattern).
        expect(source).not.toMatch(/#pricing\b/)
        expect(source).not.toMatch(/window\.location\.hash\s*=\s*['"]#\/?pricing['"]/)
        // Must route through the same event-bus helper QuotaUpgradeButton uses.
        expect(source).toMatch(/\bnavigateToPricing\(/)
    })
})
