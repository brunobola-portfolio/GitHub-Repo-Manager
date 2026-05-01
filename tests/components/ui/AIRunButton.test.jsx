import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@/hooks/useAIStatus', () => ({
    useAIStatus: vi.fn(),
}))

import { useAIStatus } from '@/hooks/useAIStatus'
import { AIRunButton } from '@/components/ui/AIRunButton'

describe('AIRunButton', () => {
    it('shows the AI label when AI is configured + healthy', () => {
        useAIStatus.mockReturnValue({ configured: true, keyInvalid: false, loading: false, keyHealth: 'ok' })
        render(<AIRunButton onClick={() => {}} label="Run with AI" />)
        expect(screen.getByRole('button')).toHaveTextContent('Run with AI')
        expect(screen.getByRole('button')).not.toBeDisabled()
    })

    it('falls back to heuristic label and stays clickable when AI is off + heuristic is available', () => {
        useAIStatus.mockReturnValue({ configured: false, keyInvalid: false, loading: false, keyHealth: 'unknown' })
        const onClick = vi.fn()
        render(<AIRunButton onClick={onClick} heuristicLabel="Suggest (heuristic)" heuristicAvailable />)
        const btn = screen.getByRole('button')
        expect(btn).toHaveTextContent('Suggest (heuristic)')
        expect(btn).not.toBeDisabled()
        fireEvent.click(btn)
        expect(onClick).toHaveBeenCalled()
    })

    it('disables itself when AI is off and there is no heuristic fallback', () => {
        useAIStatus.mockReturnValue({ configured: false, keyInvalid: false, loading: false, keyHealth: 'unknown' })
        render(<AIRunButton onClick={() => {}} />)
        expect(screen.getByRole('button')).toBeDisabled()
    })

    it('flags an invalid key in the label when configured but the key is failing', () => {
        useAIStatus.mockReturnValue({ configured: true, keyInvalid: true, loading: false, keyHealth: 'invalid' })
        render(<AIRunButton onClick={() => {}} label="Run" />)
        expect(screen.getByRole('button')).toHaveTextContent(/Run \(key invalid\)/)
    })

    it('honors the loading prop with a spinner and disabled state', () => {
        useAIStatus.mockReturnValue({ configured: true, keyInvalid: false, loading: false, keyHealth: 'ok' })
        render(<AIRunButton onClick={() => {}} loading />)
        expect(screen.getByRole('button')).toBeDisabled()
    })
})
