import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const cfg = vi.hoisted(() => ({ mock: false }))
vi.mock('@/config', async (importOriginal) => {
    const real = await importOriginal()
    return { ...real, get MOCK_MODE() { return cfg.mock }, AUTH_ENDPOINTS: { login: '/api/auth/login', logout: '/api/auth/logout' } }
})

const { TabLoadError } = await import('@/components/RepoDetail/TabLoadError')

beforeEach(() => { cfg.mock = false })

describe('TabLoadError on a 401', () => {
    it('sends the user to the real login route, not a path that does not exist', () => {
        const assign = vi.fn()
        const original = window.location
        delete window.location
        window.location = { ...original, set href(v) { assign(v) } }
        try {
            render(<TabLoadError error={{ status: 401 }} resourceLabel="workflow runs" />)
            expect(screen.getByText(/sign in again to view workflow runs/i)).toBeInTheDocument()
            fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
            expect(assign).toHaveBeenCalledWith('/api/auth/login')
        } finally {
            window.location = original
        }
    })

    it('in demo mode says the surface is not simulated instead of asking for a sign-in', () => {
        cfg.mock = true
        render(<TabLoadError error={{ status: 401 }} resourceLabel="workflow runs" />)
        expect(screen.getByText(/not simulated in demo mode/i)).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /sign in/i })).toBeNull()
    })

    it('still renders the retry state for a 500', () => {
        const onRetry = vi.fn()
        render(<TabLoadError error={{ status: 500 }} resourceLabel="branches" onRetry={onRetry} />)
        fireEvent.click(screen.getByRole('button', { name: /retry/i }))
        expect(onRetry).toHaveBeenCalled()
    })
})
