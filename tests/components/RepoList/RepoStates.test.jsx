/*
 * RepoStates — the AUTHENTICATION error branch used to render text only
 * ("Please login again") with no actionable control. It now threads an
 * `onLogin` callback and renders a primary "Sign in again" button so the
 * user isn't stuck reading instructions with nothing to click.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ErrorState } from '@/components/RepoList/RepoStates'

describe('RepoStates — ErrorState (AUTHENTICATION branch)', () => {
    it('renders a "Sign in again" button when onLogin is provided', () => {
        render(
            <ErrorState
                error="Session expired"
                errorInfo={{ type: 'AUTHENTICATION' }}
                onRefresh={vi.fn()}
                onLogin={vi.fn()}
            />
        )
        expect(screen.getByRole('button', { name: /sign in again/i })).toBeInTheDocument()
    })

    it('clicking "Sign in again" calls onLogin', () => {
        const onLogin = vi.fn()
        render(
            <ErrorState
                error="Session expired"
                errorInfo={{ type: 'AUTHENTICATION' }}
                onRefresh={vi.fn()}
                onLogin={onLogin}
            />
        )
        fireEvent.click(screen.getByRole('button', { name: /sign in again/i }))
        expect(onLogin).toHaveBeenCalledTimes(1)
    })

    it('omits the login button when onLogin is not provided (no dead control)', () => {
        render(
            <ErrorState
                error="Session expired"
                errorInfo={{ type: 'AUTHENTICATION' }}
                onRefresh={vi.fn()}
            />
        )
        expect(screen.queryByRole('button', { name: /sign in again/i })).not.toBeInTheDocument()
    })

    it('non-auth errors still render the generic "Try Again" control, unaffected', () => {
        const onRefresh = vi.fn()
        render(
            <ErrorState
                error="Something broke"
                errorInfo={{ type: 'SERVER' }}
                onRefresh={onRefresh}
                onLogin={vi.fn()}
            />
        )
        expect(screen.queryByRole('button', { name: /sign in again/i })).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: /try again/i }))
        expect(onRefresh).toHaveBeenCalledTimes(1)
    })
})
