import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const { MobileQuickActionsFab } = await import('../../src/components/MobileQuickActionsFab')

describe('MobileQuickActionsFab', () => {
    const baseHandlers = {
        onCreate: vi.fn(),
        onImport: vi.fn(),
        onOpenDevToolkit: vi.fn(),
        onOpenCommandPalette: vi.fn(),
        onOpenAIAssistant: vi.fn(),
    }

    it('renders the main FAB collapsed by default', () => {
        render(<MobileQuickActionsFab {...baseHandlers} />)
        expect(screen.getByRole('button', { name: /quick actions/i })).toBeInTheDocument()
    })

    it('expands all secondary buttons after main FAB is clicked', () => {
        render(<MobileQuickActionsFab {...baseHandlers} />)
        fireEvent.click(screen.getByRole('button', { name: /quick actions/i }))
        expect(screen.getByRole('menuitem', { name: /create/i })).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: /import/i })).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: /dev toolkit/i })).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: /search/i })).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: /repo advisor/i })).toBeInTheDocument()
    })

    it('calls onCreate when create item is clicked', () => {
        const onCreate = vi.fn()
        render(<MobileQuickActionsFab {...baseHandlers} onCreate={onCreate} />)
        fireEvent.click(screen.getByRole('button', { name: /quick actions/i }))
        fireEvent.click(screen.getByRole('menuitem', { name: /create/i }))
        expect(onCreate).toHaveBeenCalled()
    })

    it('calls onOpenCommandPalette when search item is clicked', () => {
        const onOpenCommandPalette = vi.fn()
        render(<MobileQuickActionsFab {...baseHandlers} onOpenCommandPalette={onOpenCommandPalette} />)
        fireEvent.click(screen.getByRole('button', { name: /quick actions/i }))
        fireEvent.click(screen.getByRole('menuitem', { name: /search/i }))
        expect(onOpenCommandPalette).toHaveBeenCalled()
    })

    it('calls onOpenAIAssistant when Repo Advisor item is clicked', () => {
        const onOpenAIAssistant = vi.fn()
        render(<MobileQuickActionsFab {...baseHandlers} onOpenAIAssistant={onOpenAIAssistant} />)
        fireEvent.click(screen.getByRole('button', { name: /quick actions/i }))
        fireEvent.click(screen.getByRole('menuitem', { name: /repo advisor/i }))
        expect(onOpenAIAssistant).toHaveBeenCalled()
    })

    it('closes when ESC is pressed', () => {
        render(<MobileQuickActionsFab {...baseHandlers} />)
        fireEvent.click(screen.getByRole('button', { name: /quick actions/i }))
        expect(screen.queryByRole('menuitem', { name: /create/i })).toBeInTheDocument()
        fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' })
        expect(screen.queryByRole('menuitem', { name: /create/i })).not.toBeInTheDocument()
    })
})
