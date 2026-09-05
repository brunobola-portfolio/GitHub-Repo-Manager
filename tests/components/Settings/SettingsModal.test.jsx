import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, fireEvent, waitFor, act } from '@testing-library/react'

// Cache-clear now sends a CSRF header; stub the token fetch so it doesn't
// consume the first response from the test's fetch queue.
vi.mock('@/utils/api', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, getCsrfToken: vi.fn(async () => 'csrf-test-token') }
})

import { SettingsModal } from '@/components/SettingsModal'
import { ThemeProvider } from '@/hooks/useTheme.jsx'
import { renderWithProviders } from '../../helpers/render-with-providers'

// Mock framer-motion to make assertions deterministic.
vi.mock('framer-motion', () => {
    const React = require('react')
    function passthrough({ children, ...rest }) {
        // eslint-disable-next-line no-unused-vars -- swallow framer-motion-only props so they don't reach the DOM
        const { initial, animate, exit, variants, transition, layout, whileHover, whileTap, ...clean } = rest
        return React.createElement(React.Fragment, null, children)
    }
    const motion = new Proxy({}, { get: () => passthrough })
    return {
        motion,
        AnimatePresence: ({ children }) => children,
        useReducedMotion: () => true,
        useMotionValue: (v) => ({ get: () => v, set: () => {} }),
        useTransform: (v) => v,
        MotionConfig: ({ children }) => children,
    }
})

// The API-Keys / AI-Config / License / Audit tab children trigger a bunch of
// network work we don't care about here — we're testing the General tab's
// "Clear Cache" button only. Stubbing fetch to always reject keeps the
// unrelated tabs quiet.
//
// The General tab's digest-frequency control (G7) fetches its setting on
// EVERY mount, before any test gets to click anything — so it must never
// consume a queued mockResolvedValueOnce/mockRejectedValueOnce meant for the
// Clear Cache call. It's intercepted here with a stable canned response;
// `fetchMock` (what tests below queue against) only ever sees the calls
// they're actually testing.
let fetchMock

beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', vi.fn((url, opts) => {
        if (String(url).includes('/notifications/digest/settings')) {
            return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ frequency: 'off' }) })
        }
        return fetchMock(url, opts)
    }))
})

afterEach(() => {
    vi.unstubAllGlobals()
})

function renderModal() {
    return renderWithProviders(
        <ThemeProvider>
            <SettingsModal isOpen={true} onClose={() => {}} initialTab="general" />
        </ThemeProvider>
    )
}

describe('SettingsModal — cache clear toast', () => {
    it('fires a success toast when cache clear succeeds', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' }, json: () => Promise.resolve({ cleared: 42 }),
        })

        renderModal()

        // Find the clear-cache button (labelled "Clear Cache")
        const btn = await screen.findByRole('button', { name: /clear cache/i })
        await act(async () => { fireEvent.click(btn) })

        await waitFor(() => {
            // Toast body is rendered by <ToastContainer>; we just assert the
            // text appears on screen somewhere.
            expect(
                screen.getAllByText(/cache cleared/i).length
            ).toBeGreaterThanOrEqual(1)
        })
    })

    it('fires an error toast when cache clear fails', async () => {
        fetchMock.mockRejectedValueOnce(new Error('network down'))

        renderModal()

        const btn = await screen.findByRole('button', { name: /clear cache/i })
        await act(async () => { fireEvent.click(btn) })

        await waitFor(() => {
            expect(
                screen.getAllByText(/failed to clear cache/i).length
            ).toBeGreaterThanOrEqual(1)
        })
    })
})

describe('SettingsModal — General tab digest-frequency control (G7)', () => {
    it('loads the current frequency and PATCHes on change', async () => {
        vi.stubGlobal('fetch', vi.fn((url, opts) => {
            if (String(url).includes('/notifications/digest/settings') && (!opts || opts.method === undefined)) {
                return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ frequency: 'off' }) })
            }
            if (String(url).includes('/notifications/digest/settings') && opts?.method === 'PATCH') {
                return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ frequency: 'daily' }) })
            }
            return fetchMock(url, opts)
        }))

        renderModal()

        const select = await screen.findByLabelText('Email digest frequency')
        expect(select).toHaveTextContent(/off/i)

        fireEvent.click(select)
        const dailyOption = await screen.findByRole('option', { name: 'Daily' })
        fireEvent.click(dailyOption)

        await waitFor(() => {
            expect(screen.getByLabelText('Email digest frequency')).toHaveTextContent(/daily/i)
        })
    })
})

// Regression (FE-14): the active-tab reset used to run in a follow-up effect
// keyed on [isOpen, initialTab]. These exercise the render-time replacement:
// it must still reset on open/reopen and on an initialTab change while open,
// but must NOT fight a manual tab click when re-invoked with an unchanged
// initialTab (the bug a naive "always sync from prop" version would have).
describe('SettingsModal — active tab tracks initialTab across open/reopen', () => {
    it('honours initialTab on open, and again when initialTab changes while still open', async () => {
        fetchMock.mockResolvedValue({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: () => Promise.resolve({}) })

        const { rerender } = renderWithProviders(
            <ThemeProvider>
                <SettingsModal isOpen={true} onClose={() => {}} initialTab="general" />
            </ThemeProvider>
        )
        expect(await screen.findByRole('tab', { name: /^General$/i })).toHaveAttribute('aria-selected', 'true')

        rerender(
            <ThemeProvider>
                <SettingsModal isOpen={true} onClose={() => {}} initialTab="about" />
            </ThemeProvider>
        )
        expect(await screen.findByRole('tab', { name: /^About$/i })).toHaveAttribute('aria-selected', 'true')
        expect(screen.getByRole('tab', { name: /^General$/i })).toHaveAttribute('aria-selected', 'false')
    })

    it('does not override a manual tab switch on a re-render with the same initialTab', async () => {
        fetchMock.mockResolvedValue({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: () => Promise.resolve({}) })

        const { rerender } = renderWithProviders(
            <ThemeProvider>
                <SettingsModal isOpen={true} onClose={() => {}} initialTab="general" />
            </ThemeProvider>
        )
        await screen.findByRole('tab', { name: /^General$/i })

        fireEvent.click(screen.getByRole('tab', { name: /^About$/i }))
        expect(await screen.findByRole('tab', { name: /^About$/i })).toHaveAttribute('aria-selected', 'true')

        // Re-render with the SAME initialTab prop — an unrelated parent
        // re-render, not a fresh "open with initialTab" request.
        rerender(
            <ThemeProvider>
                <SettingsModal isOpen={true} onClose={() => {}} initialTab="general" />
            </ThemeProvider>
        )
        expect(screen.getByRole('tab', { name: /^About$/i })).toHaveAttribute('aria-selected', 'true')
    })
})
