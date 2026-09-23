import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ProfileLoadFailed } from '@/components/ui/ProfileLoadFailed'

describe('ProfileLoadFailed', () => {
    it('explains the failure and offers retry and sign out', () => {
        const onRetry = vi.fn()
        const onSignOut = vi.fn()
        render(<ProfileLoadFailed message="GitHub 502" onRetry={onRetry} onSignOut={onSignOut} />)
        expect(screen.getByRole('alert')).toHaveTextContent(/signed in, but GitHub did not answer/i)
        expect(screen.getByRole('alert')).toHaveTextContent('GitHub 502')
        fireEvent.click(screen.getByRole('button', { name: /try again/i }))
        fireEvent.click(screen.getByRole('button', { name: /sign out/i }))
        expect(onRetry).toHaveBeenCalledOnce()
        expect(onSignOut).toHaveBeenCalledOnce()
        expect(screen.queryByRole('button', { name: /^sign in/i })).toBeNull()
    })
})
