/*
 * LicenseActivationModal — hot-install behaviour.
 *
 * Verifies the modal hits POST /api/v1/license/install (not the older
 * /validate-only path), surfaces the activated state inline, and
 * dispatches `app:license-changed` so the rest of the app refetches the
 * tier without a page reload.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LicenseActivationModal } from '../../../src/components/Settings/LicenseActivationModal'
import { onAppEvent, APP_EVENTS } from '../../../src/utils/appEvents'

// fetchWithRetry is a thin wrapper over fetch — replace it so we don't
// pull in the CSRF + retry pipeline for unit tests.
vi.mock('../../../src/utils/api', () => ({
    fetchWithRetry: vi.fn(),
}))
import { fetchWithRetry } from '../../../src/utils/api'

beforeEach(() => {
    fetchWithRetry.mockReset()
})

// Capture the app-event the modal fires on success via the emitter.
let licenseChangedCount = 0
let offLicenseChanged
beforeEach(() => {
    licenseChangedCount = 0
    offLicenseChanged = onAppEvent(APP_EVENTS.LICENSE_CHANGED, () => { licenseChangedCount += 1 })
})
afterEach(() => {
    offLicenseChanged?.()
})

function fillKey(value = 'grm_lic_test_payload') {
    const ta = screen.getByLabelText(/license key/i)
    fireEvent.change(ta, { target: { value } })
}

describe('LicenseActivationModal', () => {
    it('disables the activate button until a key is entered', () => {
        render(<LicenseActivationModal isOpen onClose={() => {}} />)
        const btn = screen.getByTestId('license-activate-button')
        expect(btn).toBeDisabled()
        fillKey()
        expect(btn).not.toBeDisabled()
    })

    it('calls /install (not /validate) and shows the activated state', async () => {
        fetchWithRetry.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                ok: true,
                active: true,
                source: 'db',
                tier: 'pro',
                org: 'Acme Inc',
                seats: 10,
                expiresAt: '2027-12-31T00:00:00.000Z',
            }),
        })

        render(<LicenseActivationModal isOpen onClose={() => {}} />)
        fillKey()
        fireEvent.click(screen.getByTestId('license-activate-button'))

        await waitFor(() => expect(screen.getByTestId('license-activated-card')).toBeInTheDocument())

        expect(fetchWithRetry).toHaveBeenCalledTimes(1)
        const [url, init] = fetchWithRetry.mock.calls[0]
        expect(url).toBe('/api/v1/license/install')
        expect(init.method).toBe('POST')
        expect(JSON.parse(init.body)).toEqual({ key: 'grm_lic_test_payload' })

        // License details rendered. Seats are deliberately absent — see the
        // "no fictional seat count" block below.
        expect(screen.getByText(/license activated/i)).toBeInTheDocument()
        expect(screen.getByText('pro')).toBeInTheDocument()
        expect(screen.getByText('Acme Inc')).toBeInTheDocument()
        expect(screen.queryByText('10')).not.toBeInTheDocument()
    })

    it('dispatches app:license-changed on successful activation', async () => {
        fetchWithRetry.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ ok: true, active: true, tier: 'pro' }),
        })

        render(<LicenseActivationModal isOpen onClose={() => {}} />)
        fillKey()
        fireEvent.click(screen.getByTestId('license-activate-button'))

        await waitFor(() => {
            expect(licenseChangedCount).toBeGreaterThan(0)
        })
    })

    it('surfaces the env-pinned conflict (409) with a friendly message', async () => {
        const err = new Error('conflict')
        err.status = 409
        err.data = { error: 'env_license_set' }
        fetchWithRetry.mockRejectedValueOnce(err)

        render(<LicenseActivationModal isOpen onClose={() => {}} />)
        fillKey()
        fireEvent.click(screen.getByTestId('license-activate-button'))

        await waitFor(() => expect(screen.getByText(/activation failed/i)).toBeInTheDocument())
        expect(screen.getByText(/LICENSE_KEY is set/i)).toBeInTheDocument()
        // No license-activated card should be visible.
        expect(screen.queryByTestId('license-activated-card')).not.toBeInTheDocument()
    })

    it('surfaces a server error message verbatim on 4xx', async () => {
        const err = new Error('bad')
        err.status = 400
        err.data = { error: 'Invalid or expired license key' }
        fetchWithRetry.mockRejectedValueOnce(err)

        render(<LicenseActivationModal isOpen onClose={() => {}} />)
        fillKey()
        fireEvent.click(screen.getByTestId('license-activate-button'))

        await waitFor(() => expect(screen.getByText(/invalid or expired license key/i)).toBeInTheDocument())
    })

    it('hides the activate button after success (only Done remains)', async () => {
        fetchWithRetry.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ ok: true, active: true, tier: 'pro' }),
        })

        render(<LicenseActivationModal isOpen onClose={() => {}} />)
        fillKey()
        fireEvent.click(screen.getByTestId('license-activate-button'))

        await waitFor(() => expect(screen.getByTestId('license-activated-card')).toBeInTheDocument())
        expect(screen.queryByTestId('license-activate-button')).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: /done/i })).toBeInTheDocument()
    })

    it('shows the bootstrap admin note when the response carries bootstrap:true', async () => {
        fetchWithRetry.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ ok: true, active: true, bootstrap: true, tier: 'pro' }),
        })

        render(<LicenseActivationModal isOpen onClose={() => {}} />)
        fillKey()
        fireEvent.click(screen.getByTestId('license-activate-button'))

        await waitFor(() => expect(screen.getByTestId('bootstrap-admin-note')).toBeInTheDocument())
        expect(screen.getByText(/granted/i)).toBeInTheDocument()
    })

    it('does not show the bootstrap note on a regular admin install', async () => {
        fetchWithRetry.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ ok: true, active: true, bootstrap: false, tier: 'pro' }),
        })

        render(<LicenseActivationModal isOpen onClose={() => {}} />)
        fillKey()
        fireEvent.click(screen.getByTestId('license-activate-button'))

        await waitFor(() => expect(screen.getByTestId('license-activated-card')).toBeInTheDocument())
        expect(screen.queryByTestId('bootstrap-admin-note')).not.toBeInTheDocument()
    })
})

/*
 * The activation receipt showed a seat count that is fiction. Every Stripe
 * licence is minted with `seats: 1` (stripe-webhooks.js does
 * `parseInt(metadata?.seats) || 1` and billing.js never sets the key), nothing
 * enforces it, and every pricing surface promises unlimited team members — so
 * "Seats: 1" was the first thing a new Pro customer saw, and it was wrong.
 */
describe('LicenseActivationModal — no fictional seat count', () => {
    it('does not show a Seats row on the activation receipt', async () => {
        fetchWithRetry.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ ok: true, active: true, tier: 'pro', org: 'Acme', seats: 1 }),
        })

        render(<LicenseActivationModal isOpen onClose={() => {}} />)
        fillKey()
        fireEvent.click(screen.getByTestId('license-activate-button'))

        await waitFor(() => expect(screen.getByText(/license activated/i)).toBeInTheDocument())
        expect(screen.queryByText(/^Seats:$/i)).not.toBeInTheDocument()
        expect(screen.getByText(/Acme/)).toBeInTheDocument()
    })
})
