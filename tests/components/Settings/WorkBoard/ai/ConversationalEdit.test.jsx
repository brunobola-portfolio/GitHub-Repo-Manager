import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ConversationalEdit } from '../../../../../src/components/Settings/WorkBoard/ai/ConversationalEdit'

describe('ConversationalEdit', () => {
    it('renders a textarea + Preview button', () => {
        render(<ConversationalEdit onInterpret={vi.fn()} onApply={vi.fn()} />)
        expect(screen.getByPlaceholderText(/describe what you want/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /preview/i })).toBeInTheDocument()
    })

    it('Preview calls onInterpret with the prompt', async () => {
        const onInterpret = vi.fn().mockResolvedValue({ summary: 's', actions: [], validity_token: 't.s' })
        render(<ConversationalEdit onInterpret={onInterpret} onApply={vi.fn()} />)
        fireEvent.change(screen.getByPlaceholderText(/describe what you want/i), { target: { value: 'mute all' } })
        fireEvent.click(screen.getByRole('button', { name: /preview/i }))
        await waitFor(() => expect(onInterpret).toHaveBeenCalledWith('mute all'))
    })

    it('after preview succeeds, shows diff summary + Apply button', async () => {
        const onInterpret = vi.fn().mockResolvedValue({ summary: 'Will mute 2', actions: [{ repo: 'a/b', action: 'mute' }, { repo: 'c/d', action: 'mute' }], validity_token: 't.s', skipped: 0 })
        render(<ConversationalEdit onInterpret={onInterpret} onApply={vi.fn()} />)
        fireEvent.change(screen.getByPlaceholderText(/describe what you want/i), { target: { value: 'mute' } })
        fireEvent.click(screen.getByRole('button', { name: /preview/i }))
        expect(await screen.findByText(/will mute 2/i)).toBeInTheDocument()
        expect(screen.getByText(/2 actions/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /apply/i })).toBeInTheDocument()
    })

    it('Apply calls onApply with validity_token', async () => {
        const onInterpret = vi.fn().mockResolvedValue({ summary: 's', actions: [{ repo: 'a/b', action: 'mute' }], validity_token: 't.s', skipped: 0 })
        const onApply = vi.fn().mockResolvedValue({ applied: 1, operation_id: 'op' })
        render(<ConversationalEdit onInterpret={onInterpret} onApply={onApply} />)
        fireEvent.change(screen.getByPlaceholderText(/describe what you want/i), { target: { value: 'mute' } })
        fireEvent.click(screen.getByRole('button', { name: /preview/i }))
        await screen.findByText(/1 action/i)
        fireEvent.click(screen.getByRole('button', { name: /apply/i }))
        await waitFor(() => expect(onApply).toHaveBeenCalledWith('t.s'))
    })

    it('Edit button returns to editing state', async () => {
        const onInterpret = vi.fn().mockResolvedValue({ summary: 's', actions: [], validity_token: 't.s', skipped: 0 })
        render(<ConversationalEdit onInterpret={onInterpret} onApply={vi.fn()} />)
        fireEvent.change(screen.getByPlaceholderText(/describe what you want/i), { target: { value: 'xxx' } })
        fireEvent.click(screen.getByRole('button', { name: /preview/i }))
        await screen.findByRole('button', { name: /edit/i })
        fireEvent.click(screen.getByRole('button', { name: /edit/i }))
        expect(screen.getByPlaceholderText(/describe what you want/i)).toBeInTheDocument()
    })
})
