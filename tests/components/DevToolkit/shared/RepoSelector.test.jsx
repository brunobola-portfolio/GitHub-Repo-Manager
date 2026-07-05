import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { RepoSelector } from '@/components/DevToolkit/shared/RepoSelector'

const REPOS = [
    { id: 1, full_name: 'octocat/hello-world' },
    { id: 2, full_name: 'acme/widgets' },
    { id: 3, full_name: 'acme/tools' },
]

function combo() {
    return screen.getByRole('combobox', { name: /repository/i })
}

describe('RepoSelector (migrated onto ui/Select)', () => {
    afterEach(cleanup)

    it('shows the placeholder when nothing is selected', () => {
        render(<RepoSelector repos={REPOS} selected={null} onSelect={() => {}} />)
        expect(screen.getByText('Select repository...')).toBeInTheDocument()
    })

    it('reflects the selected repo on the trigger', () => {
        render(<RepoSelector repos={REPOS} selected={REPOS[1]} onSelect={() => {}} />)
        expect(screen.getByRole('combobox', { name: /repository/i })).toHaveTextContent('acme/widgets')
    })

    it('opens the listbox on click and lists repos', () => {
        render(<RepoSelector repos={REPOS} selected={null} onSelect={() => {}} />)
        fireEvent.click(combo())
        expect(screen.getByRole('listbox')).toBeInTheDocument()
        expect(screen.getByRole('option', { name: 'octocat/hello-world' })).toBeInTheDocument()
        expect(screen.getByRole('option', { name: 'acme/tools' })).toBeInTheDocument()
    })

    it('selecting an option calls onSelect with the repo object and closes', () => {
        const onSelect = vi.fn()
        render(<RepoSelector repos={REPOS} selected={null} onSelect={onSelect} />)
        fireEvent.click(combo())
        fireEvent.click(screen.getByRole('option', { name: 'acme/tools' }))
        expect(onSelect).toHaveBeenCalledWith(REPOS[2])
        // AnimatePresence keeps the panel mounted during exit in jsdom, so assert
        // the collapsed state via aria-expanded rather than DOM removal.
        expect(combo()).toHaveAttribute('aria-expanded', 'false')
    })

    it('search input filters the visible options', () => {
        render(<RepoSelector repos={REPOS} selected={null} onSelect={() => {}} />)
        fireEvent.click(combo())
        fireEvent.change(screen.getByPlaceholderText('Filter...'), { target: { value: 'tools' } })
        expect(screen.getByRole('option', { name: 'acme/tools' })).toBeInTheDocument()
        expect(screen.queryByRole('option', { name: 'octocat/hello-world' })).not.toBeInTheDocument()
    })

    it('opens with keyboard (ArrowDown) and Escape closes', () => {
        render(<RepoSelector repos={REPOS} selected={null} onSelect={() => {}} />)
        const c = combo()
        fireEvent.keyDown(c, { key: 'ArrowDown' })
        expect(c).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByRole('listbox')).toBeInTheDocument()
        fireEvent.keyDown(c, { key: 'Escape' })
        expect(c).toHaveAttribute('aria-expanded', 'false')
    })

    it('arrow navigation + Enter selects the highlighted repo', () => {
        const onSelect = vi.fn()
        render(<RepoSelector repos={REPOS} selected={null} onSelect={onSelect} />)
        const c = combo()
        fireEvent.keyDown(c, { key: 'ArrowDown' }) // open, focus index 0
        fireEvent.keyDown(c, { key: 'ArrowDown' }) // move to index 1
        fireEvent.keyDown(c, { key: 'Enter' })
        expect(onSelect).toHaveBeenCalledWith(REPOS[1])
    })
})
