/*
 * B2 (launch-readiness panel #7): /api/v1/usage used to surface only 5 of
 * the ~15 enforced per-feature AI/migration/sync quotas — the other 10
 * (Deep Review, PR Chat, PR Commands, Prompt Studio test, Diagrams, Agent
 * Rules, Security Posture, Image Gen, full migrations, sync apply) were
 * enforced server-side but invisible until a user hit the 429. This locks
 * in the extended rows + grouping ("AI Features" / "Migration & Sync") and
 * the Unlimited-not-NaN rendering contract for Infinity-limit (→ JSON null)
 * metrics.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { UsageDashboard } from '@/components/Settings/UsageDashboard'

function stubUsageFetch(body) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'application/json' }, json: async () => body,
    }))
}

afterEach(() => vi.unstubAllGlobals())

const FREE_TIER_RESPONSE = {
    tier: 'free',
    period_start: '2026-07-01T00:00:00.000Z',
    aiQueries: { current: 10, limit: 1000 },
    apiKeys: { current: 1, limit: 25 },
    repos: { limit: 1000 },
    teams: { limit: null },
    aiFeatures: {
        readme: { current: 1, limit: 25 },
        commit: { current: 2, limit: 250 },
        insights: { current: 3, limit: 75 },
        migrationRisk: { current: 0, limit: 25 },
        semanticSearch: { current: 4, limit: 375 },
        deepReview: { current: 3, limit: 10 },
        prChat: { current: 12, limit: 100 },
        prCommand: { current: 1, limit: 30 },
        promptTest: { current: 30, limit: 30 },
        diagram: { current: 2, limit: 15 },
        agentRules: { current: 4, limit: 20 },
        securityPosture: { current: 5, limit: 75 },
        image: { current: 1, limit: 5 },
    },
    migrationAndSync: {
        migrationFull: { current: 2, limit: 5 },
        syncApply: { current: 6, limit: 10 },
    },
}

describe('UsageDashboard — extended quota rows (B2)', () => {
    it('renders all 8 new AI feature rows under "AI Features" with real current/limit numbers', async () => {
        stubUsageFetch(FREE_TIER_RESPONSE)
        render(<UsageDashboard />)

        expect(await screen.findByText('AI Deep Review')).toBeInTheDocument()
        expect(screen.getByText('PR Chat')).toBeInTheDocument()
        expect(screen.getByText('PR Commands')).toBeInTheDocument()
        expect(screen.getByText('Prompt Studio Test')).toBeInTheDocument()
        expect(screen.getByText('AI Diagrams')).toBeInTheDocument()
        expect(screen.getByText('Agent Rules Generator')).toBeInTheDocument()
        expect(screen.getByText('Security Posture AI Summary')).toBeInTheDocument()
        expect(screen.getByText('AI Image Generation')).toBeInTheDocument()

        expect(screen.getByText('3 / 10')).toBeInTheDocument() // deepReview
        expect(screen.getByText('12 / 100')).toBeInTheDocument() // prChat
        expect(screen.getByText('30 / 30')).toBeInTheDocument() // promptTest — at cap
    })

    it('renders a separate "Migration & Sync" group for the 2 non-AI metered metrics', async () => {
        stubUsageFetch(FREE_TIER_RESPONSE)
        render(<UsageDashboard />)

        expect(await screen.findByText('Migration & Sync')).toBeInTheDocument()
        expect(screen.getByText('Full Migration Executions')).toBeInTheDocument()
        expect(screen.getByText('Mirror Sync Apply')).toBeInTheDocument()
        expect(screen.getByText('2 / 5')).toBeInTheDocument()
        expect(screen.getByText('6 / 10')).toBeInTheDocument()
    })

    it('renders Unlimited — never NaN — for Infinity-limit metrics (JSON null) on Enterprise, and hides both groups when every row is unlimited', async () => {
        stubUsageFetch({
            tier: 'enterprise',
            period_start: '2026-07-01T00:00:00.000Z',
            aiQueries: { current: 40, limit: null },
            apiKeys: { current: 1, limit: 100 },
            repos: { limit: null },
            teams: { limit: null },
            aiFeatures: {
                readme: { current: 1, limit: null },
                commit: { current: 2, limit: null },
                insights: { current: 3, limit: null },
                migrationRisk: { current: 0, limit: null },
                semanticSearch: { current: 4, limit: null },
                deepReview: { current: 40, limit: null },
                prChat: { current: 12, limit: null },
                prCommand: { current: 1, limit: null },
                promptTest: { current: 30, limit: null },
                diagram: { current: 2, limit: null },
                agentRules: { current: 4, limit: null },
                securityPosture: { current: 5, limit: null },
                image: { current: 1, limit: null },
            },
            migrationAndSync: {
                migrationFull: { current: 2, limit: null },
                syncApply: { current: 6, limit: null },
            },
        })
        render(<UsageDashboard />)

        await screen.findByTestId('usage-dashboard')
        // Every row is unlimited on Enterprise — both grouped sections have
        // nothing informative to show, mirroring the pre-existing behaviour
        // for the original 5 AI-feature rows.
        expect(screen.queryByText('AI Features')).not.toBeInTheDocument()
        expect(screen.queryByText('Migration & Sync')).not.toBeInTheDocument()
        expect(screen.getByText(/40 \(unlimited\)/)).toBeInTheDocument() // top-level AI Queries bar
        expect(document.body.textContent).not.toMatch(/NaN/)
    })

    it('renders a mixed tier (one finite row keeps the group visible) with Unlimited on the Infinity rows, never NaN', async () => {
        stubUsageFetch({
            ...FREE_TIER_RESPONSE,
            aiFeatures: {
                ...FREE_TIER_RESPONSE.aiFeatures,
                // Simulate a partial-Infinity mix so the "AI Features" group
                // stays visible (promptTest is finite) while deepReview must
                // still render "Unlimited", not NaN, for its own row.
                deepReview: { current: 40, limit: null },
            },
        })
        render(<UsageDashboard />)

        expect(await screen.findByText('AI Deep Review')).toBeInTheDocument()
        expect(screen.getByText(/40 \(unlimited\)/)).toBeInTheDocument()
        expect(document.body.textContent).not.toMatch(/NaN/)
    })

    it('skips a row gracefully when a metric is absent from the API response (rolling-deploy backward compat)', async () => {
        const { image: _omit, ...aiFeaturesWithoutImage } = FREE_TIER_RESPONSE.aiFeatures
        stubUsageFetch({ ...FREE_TIER_RESPONSE, aiFeatures: aiFeaturesWithoutImage })
        render(<UsageDashboard />)

        await screen.findByText('AI Deep Review')
        expect(screen.queryByText('AI Image Generation')).not.toBeInTheDocument()
    })
})
