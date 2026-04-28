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
let fetchMock

beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
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
            json: () => Promise.resolve({ cleared: 42 }),
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
