import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { BranchSelector } from '@/components/DevToolkit/shared/BranchSelector'

const BRANCHES = ['main', 'feature/a', 'feature/b', 'hotfix/c', 'release/1', 'docs/x']

function combo() {
    return screen.getByRole('combobox', { name: /branch/i })
}

describe('BranchSelector (migrated onto ui/Select)', () => {
    afterEach(cleanup)

    it('renders the visible label above the control', () => {
        render(<BranchSelector branches={BRANCHES} selected="main" onSelect={() => {}} label="Head" defaultBranch="main" />)
        expect(screen.getByText('Head')).toBeInTheDocument()
    })

    it('shows the placeholder when nothing is selected', () => {
        render(<BranchSelector branches={BRANCHES} selected={null} onSelect={() => {}} />)
        expect(screen.getByText('Select branch...')).toBeInTheDocument()
    })

    it('flags the default branch with a "default" badge', () => {
        render(<BranchSelector branches={BRANCHES} selected={null} onSelect={() => {}} defaultBranch="main" />)
        fireEvent.click(combo())
        // Badge shows on the "main" row.
        const mainRow = screen.getByRole('option', { name: /main/ })
        expect(mainRow).toHaveTextContent('default')
    })

    it('accepts object branches and selects by name', () => {
        const onSelect = vi.fn()
        render(
            <BranchSelector
                branches={[{ name: 'main' }, { name: 'dev' }]}
                selected={null}
                onSelect={onSelect}
                defaultBranch="main"
            />,
        )
        fireEvent.click(combo())
        fireEvent.click(screen.getByRole('option', { name: 'dev' }))
        expect(onSelect).toHaveBeenCalledWith('dev')
    })

    it('hides the filter box when there are 5 or fewer branches', () => {
        render(<BranchSelector branches={['main', 'dev']} selected={null} onSelect={() => {}} />)
        fireEvent.click(combo())
        expect(screen.queryByPlaceholderText('Filter...')).not.toBeInTheDocument()
    })

    it('shows the filter box when there are more than 5 branches', () => {
        render(<BranchSelector branches={BRANCHES} selected={null} onSelect={() => {}} />)
        fireEvent.click(combo())
        expect(screen.getByPlaceholderText('Filter...')).toBeInTheDocument()
    })

    it('opens with keyboard (ArrowDown) and Escape closes', () => {
        render(<BranchSelector branches={BRANCHES} selected={null} onSelect={() => {}} />)
        const c = combo()
        fireEvent.keyDown(c, { key: 'ArrowDown' })
        expect(c).toHaveAttribute('aria-expanded', 'true')
        fireEvent.keyDown(c, { key: 'Escape' })
        expect(c).toHaveAttribute('aria-expanded', 'false')
    })

    it('arrow navigation + Enter selects the highlighted branch', () => {
        const onSelect = vi.fn()
        render(<BranchSelector branches={BRANCHES} selected={null} onSelect={onSelect} />)
        const c = combo()
        fireEvent.keyDown(c, { key: 'ArrowDown' }) // open, focus index 0 (main)
        fireEvent.keyDown(c, { key: 'Enter' })
        expect(onSelect).toHaveBeenCalledWith('main')
    })
})
