/*
 * The seat counter showed a limit that does not exist and that every paying
 * customer appeared to violate.
 *
 * `seatsUsed` counts every account active on the instance, while `seats` comes
 * from the licence JWT — which `stripe-webhooks.js` mints as
 * `parseInt(metadata?.seats) || 1` against a `billing.js` that never sets a
 * `seats` key. Every Stripe licence is therefore issued with seats: 1. Nothing
 * anywhere enforces it, and every pricing surface promises "Unlimited team
 * members", so a four-person self-hosted Pro team saw "4 of 1 used" in red.
 *
 * Own file because the panel short-circuits on VITE_MOCK_MODE before it
 * fetches; exercising the real branch needs the documented
 * stubEnv-then-dynamic-import pattern, which has to run before the import.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.stubEnv('VITE_MOCK_MODE', 'false')

const { LicensePlanSection } = await import('@/components/Settings/LicensePlanSection')
const { ModalProvider } = await import('@/contexts/ModalContext')

function mockLicence(overrides = {}) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' }, json: async () => ({
            active: true, source: 'license_key', tier: 'pro', org: 'Acme',
            email: 'a@b.c', seats: 1, seatsUsed: 4,
            expiresAt: '2027-01-01T00:00:00.000Z', issuedAt: '2026-01-01T00:00:00.000Z',
            ...overrides,
        }),
    }))
}

beforeEach(() => mockLicence())
afterEach(() => vi.unstubAllGlobals())

describe('LicensePlanSection — no fictional seat limit', () => {
    it('never renders an "N of M used" seat ratio', async () => {
        render(<ModalProvider><LicensePlanSection /></ModalProvider>)
        await screen.findByText(/Pro Plan/i)
        expect(screen.queryByText(/\d+\s*of\s*\d+\s*used/i)).not.toBeInTheDocument()
    })

    it('reports team members as unlimited, matching every pricing surface', async () => {
        render(<ModalProvider><LicensePlanSection /></ModalProvider>)
        await screen.findByText(/Pro Plan/i)
        // Scoped to the tile: "Unlimited" appears elsewhere on the panel too.
        expect(screen.getByText('Team members').parentElement).toHaveTextContent(/Unlimited/i)
    })

    it('still shows the real active-account count, which is a true number', async () => {
        render(<ModalProvider><LicensePlanSection /></ModalProvider>)
        await screen.findByText(/Pro Plan/i)
        expect(screen.getByText('Team members').parentElement).toHaveTextContent(/4 active in the last 30 days/i)
    })
})
