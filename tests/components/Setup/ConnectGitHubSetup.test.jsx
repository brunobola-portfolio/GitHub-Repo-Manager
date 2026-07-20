import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { ConnectGitHubSetup } from '@/components/Setup/ConnectGitHubSetup'

vi.mock('@/api/authSetup', () => ({
    getAuthSetupStatus: vi.fn(),
    submitOAuthSetup: vi.fn(),
}))

// Mock framer-motion: jsdom never finishes exit animations, so the wizard's
// AnimatePresence mode="wait" would never swap steps. Same pattern as
// BYOKUpgradeBanner.test.jsx, plus useReducedMotion for the Modal primitive.
vi.mock('framer-motion', () => {
    const React = require('react')
    function passthrough({ children, ...rest }) {
        // Swallow framer-motion-only props so they don't reach the DOM.
        const { initial: _i, animate: _a, exit: _e, variants: _v, transition: _t, layout: _l, layoutId: _lid, whileHover: _wh, whileTap: _wt, whileInView: _wiv, viewport: _vp, ...clean } = rest
        return React.createElement('div', clean, children)
    }
    const motion = new Proxy({}, { get: () => passthrough })
    return {
        motion,
        AnimatePresence: ({ children }) => children,
        useReducedMotion: () => true,
    }
})

import { getAuthSetupStatus, submitOAuthSetup } from '@/api/authSetup'

const CONFIGURABLE = {
    oauthConfigured: false,
    setupDisabled: false,
    canConfigure: true,
    homepageUrl: 'http://127.0.0.1:3001',
    callbackUrl: 'http://127.0.0.1:3001/api/auth/callback',
}

function renderWizard(status = CONFIGURABLE, props = {}) {
    getAuthSetupStatus.mockResolvedValue(status)
    return render(
        <ConnectGitHubSetup isOpen={true} onClose={() => {}} status={status} {...props} />
    )
}

beforeEach(() => {
    vi.clearAllMocks()
})

describe('ConnectGitHubSetup — guided OAuth wizard', () => {
    it('step 1 shows the EXACT per-install URLs and a pre-filled GitHub link', async () => {
        renderWizard()

        expect(await screen.findByText('Connect GitHub')).toBeInTheDocument()
        // The two values the user must register, verbatim for this install.
        expect(screen.getByText('http://127.0.0.1:3001')).toBeInTheDocument()
        expect(screen.getByText('http://127.0.0.1:3001/api/auth/callback')).toBeInTheDocument()

        // The GitHub link pre-fills name/homepage/callback via query params.
        const link = screen.getByRole('link', { name: /create oauth app/i })
        expect(link.href).toContain('github.com/settings/applications/new')
        expect(link.href).toContain(encodeURIComponent('http://127.0.0.1:3001/api/auth/callback'))
    })

    it('walks to the credentials step; submit stays disabled until both fields are filled', async () => {
        renderWizard()
        fireEvent.click(await screen.findByRole('button', { name: /i created the app/i }))

        const save = await screen.findByRole('button', { name: /save & connect/i })
        expect(save).toBeDisabled()

        fireEvent.change(screen.getByLabelText(/client id/i), { target: { value: 'Ov23liAbCdEf12345678' } })
        expect(save).toBeDisabled()
        fireEvent.change(screen.getByLabelText(/client secret/i, { selector: 'input' }), { target: { value: 'a'.repeat(40) } })
        expect(save).not.toBeDisabled()
    })

    it('happy path: submits credentials and lands on the success step', async () => {
        submitOAuthSetup.mockResolvedValue({ success: true, callbackUrl: CONFIGURABLE.callbackUrl })
        renderWizard()
        fireEvent.click(await screen.findByRole('button', { name: /i created the app/i }))

        fireEvent.change(screen.getByLabelText(/client id/i), { target: { value: 'Ov23liAbCdEf12345678' } })
        fireEvent.change(screen.getByLabelText(/client secret/i, { selector: 'input' }), { target: { value: 'a'.repeat(40) } })
        fireEvent.click(screen.getByRole('button', { name: /save & connect/i }))

        expect(await screen.findByText('GitHub connected')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /sign in with github/i })).toBeInTheDocument()
        expect(submitOAuthSetup).toHaveBeenCalledWith({
            clientId: 'Ov23liAbCdEf12345678',
            clientSecret: 'a'.repeat(40),
        })
    })

    it('surfaces the server\'s error message when saving fails', async () => {
        const err = new Error('bad')
        err.data = { error: 'That does not look like a GitHub Client Secret.' }
        submitOAuthSetup.mockRejectedValue(err)
        renderWizard()
        fireEvent.click(await screen.findByRole('button', { name: /i created the app/i }))

        fireEvent.change(screen.getByLabelText(/client id/i), { target: { value: 'Ov23liAbCdEf12345678' } })
        fireEvent.change(screen.getByLabelText(/client secret/i, { selector: 'input' }), { target: { value: 'b'.repeat(40) } })
        fireEvent.click(screen.getByRole('button', { name: /save & connect/i }))

        expect(await screen.findByText(/does not look like a GitHub Client Secret/i)).toBeInTheDocument()
        // Still on the credentials step — the user can correct and retry.
        expect(screen.getByRole('button', { name: /save & connect/i })).toBeInTheDocument()
    })

    it('hosted / non-loopback install: shows operator instructions instead of the form', async () => {
        const hosted = { ...CONFIGURABLE, canConfigure: false }
        renderWizard(hosted)

        expect(await screen.findByText(/isn't configured on this server yet/i)).toBeInTheDocument()
        // The operator still gets the exact callback URL to register.
        expect(screen.getByText('http://127.0.0.1:3001/api/auth/callback')).toBeInTheDocument()
        // No credential form is offered.
        expect(screen.queryByLabelText(/client secret/i)).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /i created the app/i })).not.toBeInTheDocument()
    })

    it('re-fetches setup status when opened (prop may be stale)', async () => {
        renderWizard()
        await waitFor(() => expect(getAuthSetupStatus).toHaveBeenCalledTimes(1))
    })
})
