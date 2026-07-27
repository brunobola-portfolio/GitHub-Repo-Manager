/*
 * Docs honesty gate — extends the README-only guard to the documents a buyer
 * reads AFTER the README.
 *
 * The 2026-07-27 premium-readiness panel found every remaining honesty
 * violation living in exactly the blind spot the existing gates left:
 * `readme-honesty.test.js` reads README.md, `pricing-feature-parity.test.js`
 * reads five components — and nothing read ROADMAP.md, NOTICE, SECURITY.md or
 * the commercial licence. Those four sold an unimplemented audit export, two
 * already-shipped free features as future Enterprise work, and "no PII" for a
 * product that stores licensee email addresses.
 */

import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

const read = (p) => readFileSync(p, 'utf8')

// Documents outside README.md that make claims to a prospective customer.
const GUARDED_DOCS = {
    'ROADMAP.md': read('ROADMAP.md'),
    'NOTICE': read('NOTICE'),
    'SECURITY.md': read('SECURITY.md'),
    'docs/LICENSE-COMMERCIAL.md': read('docs/LICENSE-COMMERCIAL.md'),
    'docs/billing-and-licensing.md': read('docs/billing-and-licensing.md'),
}

describe('SECURITY.md data-handling claims', () => {
    const security = GUARDED_DOCS['SECURITY.md']

    // The product stores licensee emails (installed_license.email, users.email,
    // issued_licenses) and Stripe customer/subscription ids. A blanket "no PII"
    // in a security-disclosure document is the kind of claim a buyer's legal
    // team relies on.
    it('does not claim PII is limited to usernames and session tokens', () => {
        expect(security).not.toMatch(/no pii/i)
        expect(security).not.toMatch(/beyond GitHub usernames and session tokens/i)
    })

    it('discloses that email addresses are stored', () => {
        expect(security).toMatch(/email/i)
    })
})

describe('paid-tier claims match the free-first + BYOK-permanent model', () => {
    // Pro sells headroom, API keys and support. It unlocks no features: there
    // is no requireTier('pro') anywhere in server/routes/. Any doc promising
    // paid "additional features" contradicts the rebalance.
    it('NOTICE does not sell paid tiers as unlocking additional features', () => {
        expect(GUARDED_DOCS['NOTICE']).not.toMatch(/additional features/i)
    })

    // BYOK is permanent (2026-07-27 product decision): no tier includes
    // managed inference, so no document may PROMISE we pay for tokens.
    //
    // Matching the bare phrase would be wrong — these documents legitimately
    // say "no tier includes managed inference", which is the claim we want
    // them to keep making. Only affirmative promises are a violation, so this
    // inspects the line and skips negated ones.
    const NEGATED = /\b(no|never|not|without|nor)\b/i
    it('no guarded doc promises included or managed AI inference', () => {
        for (const [name, text] of Object.entries(GUARDED_DOCS)) {
            const offenders = text
                .split(/\r?\n/)
                .filter((line) => /included AI credits|managed inference|we pay for (the )?tokens|AI credits included/i.test(line))
                .filter((line) => !NEGATED.test(line))
            expect(offenders, `${name} promises managed inference:\n${offenders.join('\n')}`).toEqual([])
        }
    })
})

describe('ROADMAP does not sell shipped features as future work', () => {
    const roadmap = GUARDED_DOCS['ROADMAP.md']
    // Everything above "Recently Shipped" is unshipped by definition.
    const futureSection = roadmap.split(/^##\s+Recently Shipped/mi)[0]

    // Both shipped and are free on every tier; both were listed under
    // "Next (Q3 2026) — Enterprise" while the same file listed them as shipped
    // further down.
    const SHIPPED_AND_FREE = ['DORA', 'Azure DevOps Server']

    for (const feature of SHIPPED_AND_FREE) {
        it(`"${feature}" is not listed as upcoming work`, () => {
            expect(futureSection).not.toContain(feature)
        })
    }

    it('does not tag unshipped items with a tier, contradicting free-first', () => {
        // Compliance deliverables (SSO/SAML, SBOM) are the documented
        // exception — they are genuinely Enterprise-only when they land.
        const COMPLIANCE_EXCEPTION = /SSO|SAML|SBOM/
        const offenders = futureSection
            .split(/\r?\n/)
            .filter((line) => /^\s*[-*]\s+\*\*/.test(line))
            .filter((line) => /—\s*(Pro|Enterprise|Pro \+ Enterprise|All tiers|Free)\b/.test(line))
            .filter((line) => !COMPLIANCE_EXCEPTION.test(line))
        expect(offenders, `Roadmap items tagged with a tier:\n${offenders.join('\n')}`).toEqual([])
    })
})

describe('the in-app Roadmap page agrees with ROADMAP.md', () => {
    // ROADMAP.md was corrected first and the in-app page kept its old data, so
    // the app still sold DORA and Azure DevOps Server as future Enterprise work
    // and labelled now-free features (README Enhance, Batch Indexing, AI
    // Issue-to-PR Planner) as Pro. A doc-only fix is not a fix.
    const page = read('src/components/Roadmap/RoadmapPage.jsx')
    const unshipped = page.slice(page.indexOf("id: 'next'"), page.indexOf("id: 'shipped'"))

    it('carries no tier badge on unshipped work, except compliance deliverables', () => {
        const tagged = unshipped
            .split(/\r?\n/)
            .filter((line) => /tier:\s*'/.test(line))
            .filter((line) => !/SSO \/ SAML|SBOM Export/.test(line))
        expect(tagged, `Unshipped roadmap items tagged with a tier:\n${tagged.join('\n')}`).toEqual([])
    })

    it('does not list already-shipped features as upcoming', () => {
        for (const shipped of ['DORA', 'Azure DevOps Server']) {
            expect(unshipped, `"${shipped}" shipped and is free — it cannot be upcoming work`).not.toContain(shipped)
        }
    })
})

describe('the commercial licence describes the licence the issuer actually mints', () => {
    const commercial = GUARDED_DOCS['docs/LICENSE-COMMERCIAL.md']

    // stripe-webhooks.js derives the term from the billing period: monthly
    // checkout mints a 1-month key. The contract promised 12 months for both.
    it('does not promise a flat 12-month term for every licence', () => {
        expect(commercial).not.toMatch(/issued for 12-month terms/i)
    })

    // Free features must not appear as paid value. semanticSearch is true and
    // teamsMax/teamMembersMax are Infinity on Free.
    it('does not sell semantic search or unlimited teams as paid-only', () => {
        const proSection = commercial.slice(0, commercial.length)
        expect(proSection).not.toMatch(/Pro[^\n]*\bsemantic search\b[^\n]*\bunlimited teams\b/i)
    })
})
