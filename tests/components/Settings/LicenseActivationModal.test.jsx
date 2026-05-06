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

// fetchWithRetry is a thin wrapper over fetch — replace it so we don't
// pull in the CSRF + retry pipeline for unit tests.
vi.mock('../../../src/utils/api', () => ({
    fetchWithRetry: vi.fn(),
}))
import { fetchWithRetry } from '../../../src/utils/api'

beforeEach(() => {
    fetchWithRetry.mockReset()
})

const dispatchSpy = vi.fn()
const originalDispatch = window.dispatchEvent
beforeEach(() => {
    dispatchSpy.mockReset()
    window.dispatchEvent = (...args) => {
        dispatchSpy(...args)
        return originalDispatch.call(window, ...args)
    }
})
afterEach(() => {
    window.dispatchEvent = originalDispatch
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

        // License details rendered.
        expect(screen.getByText(/license activated/i)).toBeInTheDocument()
        expect(screen.getByText('pro')).toBeInTheDocument()
        expect(screen.getByText('Acme Inc')).toBeInTheDocument()
        expect(screen.getByText('10')).toBeInTheDocument()
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
            const events = dispatchSpy.mock.calls.map((c) => c[0]?.type)
            expect(events).toContain('app:license-changed')
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
