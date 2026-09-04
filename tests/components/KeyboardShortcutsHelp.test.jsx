import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { KeyboardShortcutsHelp } from '@/components/KeyboardShortcutsHelp'
import { getAllShortcuts } from '@/config/keyboardShortcuts'

/*
 * KeyboardShortcutsHelp is now the ONE dialog shell every keyboard-help
 * surface renders through (F15: the four overlays used to each re-type
 * their own <kbd> recipe). WorkBoard/KeyboardHelpModal, PRReview/
 * KeyboardHelpOverlay and the wizard's ShortcutsOverlay are thin wrappers
 * around it — see their own test files for the scoped behaviour. This file
 * covers the shell itself: the unscoped (global `?`) dialog and the
 * scope-filtering / grouping contract the wrappers rely on.
 */

afterEach(() => cleanup())

describe('KeyboardShortcutsHelp — unscoped (the global `?` dialog)', () => {
    it('renders nothing when closed', () => {
        render(<KeyboardShortcutsHelp isOpen={false} onClose={vi.fn()} shortcuts={getAllShortcuts()} />)
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('includes a Work Board section — U32: the old global dialog omitted it entirely', () => {
        render(<KeyboardShortcutsHelp isOpen onClose={vi.fn()} shortcuts={getAllShortcuts()} />)
        // Multiple scopes share the dialog, so a "Navigate"/"Actions" group
        // renders prefixed by its own scope ("Work Board — Navigate") to
        // avoid colliding with another scope's same-named group — hence
        // getAllByRole here rather than a single unique heading.
        expect(screen.getAllByRole('heading', { name: /work board/i }).length).toBeGreaterThan(0)
    })

    it('lists the Repositories and Live Inbox j/k/Enter row-navigation shortcuts', () => {
        render(<KeyboardShortcutsHelp isOpen onClose={vi.fn()} shortcuts={getAllShortcuts()} />)
        expect(screen.getAllByRole('heading', { name: /repositories/i }).length).toBeGreaterThan(0)
        expect(screen.getAllByRole('heading', { name: /live inbox/i }).length).toBeGreaterThan(0)
        expect(screen.getByText('Next repository')).toBeInTheDocument()
        expect(screen.getByText('Open focused repository')).toBeInTheDocument()
        expect(screen.getByText('Next item')).toBeInTheDocument()
    })

    it('shows the g-then-key navigation chords as two separate key chips', () => {
        const { container } = render(<KeyboardShortcutsHelp isOpen onClose={vi.fn()} shortcuts={getAllShortcuts()} />)
        expect(screen.getByRole('heading', { name: /navigation/i })).toBeInTheDocument()
        expect(screen.getByText('Go to Work Board')).toBeInTheDocument()
        // Two <Kbd> chips for a chord entry, not one "g+d"-style string.
        const kbds = container.querySelectorAll('kbd')
        expect(kbds.length).toBeGreaterThan(2)
    })

    it('renders every key through <Kbd> (aria-hidden pills) — no bare <kbd>', () => {
        const { container } = render(<KeyboardShortcutsHelp isOpen onClose={vi.fn()} shortcuts={getAllShortcuts()} />)
        const kbds = container.querySelectorAll('kbd')
        expect(kbds.length).toBeGreaterThan(0)
        for (const el of kbds) expect(el).toHaveAttribute('aria-hidden', 'true')
    })
})

describe('KeyboardShortcutsHelp — scoped to a single surface', () => {
    it('flattens a single-group scope (wizard) without a redundant heading', () => {
        const { container } = render(
            <KeyboardShortcutsHelp isOpen onClose={vi.fn()} shortcuts={getAllShortcuts()} scope="wizard" title="Keyboard shortcuts" subtitle="Repo Select" />
        )
        expect(container.querySelectorAll('h3')).toHaveLength(0)
        expect(screen.getByText('Navigate rows')).toBeInTheDocument()
    })

    it('narrows Work Board to just its own Navigate/Actions/Global groups', () => {
        render(<KeyboardShortcutsHelp isOpen onClose={vi.fn()} shortcuts={getAllShortcuts()} scope="workBoard" />)
        expect(screen.getByRole('heading', { name: /^navigate$/i })).toBeInTheDocument()
        expect(screen.getByRole('heading', { name: /^actions$/i })).toBeInTheDocument()
        expect(screen.queryByText('Next file')).not.toBeInTheDocument() // that's PR Review's, not Work Board's
    })

    it('narrows PR Review to just its own Navigate/Review/Diff/Help groups', () => {
        render(<KeyboardShortcutsHelp isOpen onClose={vi.fn()} shortcuts={getAllShortcuts()} scope="prReview" />)
        expect(screen.getByRole('heading', { name: /^navigate$/i })).toBeInTheDocument()
        expect(screen.getByRole('heading', { name: /^review$/i })).toBeInTheDocument()
        expect(screen.getByRole('heading', { name: /^diff$/i })).toBeInTheDocument()
        expect(screen.getByText('Next file')).toBeInTheDocument()
    })
})
