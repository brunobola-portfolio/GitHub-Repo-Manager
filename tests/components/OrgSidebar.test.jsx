/*
 * Unit tests for OrgSidebar — the repos-view organization-navigation sidebar
 * extracted from App.jsx. The component owns its own overlay open/close state
 * and Escape/resize handling; the parent only supplies data + an onSelectOrg
 * handler. OrgPanel is stubbed to a prop-echo so these assert OrgSidebar's own
 * logic (mode switching, the overlay lifecycle, and that selection in every
 * surface reaches onSelectOrg) rather than OrgPanel's internals.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'

vi.mock('framer-motion', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        AnimatePresence: ({ children }) => children,
    }
})

vi.mock('@/components/OrgPanel', () => ({
    OrgPanel: ({ orgs, selectedOrg, onSelectOrg, onCreateOrg }) => (
        <div data-testid="org-panel" data-orgs={(orgs || []).length} data-selected={selectedOrg || ''}>
            <button onClick={() => onSelectOrg(null)}>op-all</button>
            <button onClick={() => onSelectOrg('acme')}>op-acme</button>
            <button onClick={onCreateOrg}>op-create</button>
        </div>
    ),
}))

const { OrgSidebar } = await import('@/components/OrgSidebar')

const ORGS = [
    { login: 'acme', avatar_url: '' },
    { login: 'globex', avatar_url: 'https://example.com/g.png' },
]
const USER = { login: 'octocat', avatar_url: 'https://github.com/octocat.png' }

function renderSidebar(props = {}) {
    const onSelectOrg = props.onSelectOrg || vi.fn()
    const onCreateOrg = props.onCreateOrg || vi.fn()
    const utils = render(
        <OrgSidebar
            user={USER}
            orgs={ORGS}
            selectedOrg={props.selectedOrg ?? null}
            stats={{}}
            leftMode={props.leftMode || 'expanded'}
            onSelectOrg={onSelectOrg}
            onCreateOrg={onCreateOrg}
        />
    )
    return { ...utils, onSelectOrg, onCreateOrg }
}

beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
})

describe('OrgSidebar', () => {
    it('renders the expanded OrgPanel in expanded mode', () => {
        renderSidebar({ leftMode: 'expanded', selectedOrg: 'acme' })
        const panel = screen.getByTestId('org-panel')
        expect(panel).toHaveAttribute('data-orgs', '2')
        expect(panel).toHaveAttribute('data-selected', 'acme')
        // No collapsed-rail expand button in expanded mode.
        expect(screen.queryByRole('button', { name: /expand organization panel/i })).toBeNull()
    })

    it('selecting an org in the expanded panel calls onSelectOrg', () => {
        const { onSelectOrg } = renderSidebar({ leftMode: 'expanded' })
        fireEvent.click(screen.getByText('op-acme'))
        expect(onSelectOrg).toHaveBeenCalledWith('acme')
    })

    it('renders the collapsed rail (not the OrgPanel) in slim mode', () => {
        renderSidebar({ leftMode: 'slim' })
        expect(screen.getByRole('button', { name: /expand organization panel/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /all organizations/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'acme' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'globex' })).toBeInTheDocument()
        expect(screen.queryByTestId('org-panel')).toBeNull()
    })

    it('a rail org button calls onSelectOrg with the org login', () => {
        const { onSelectOrg } = renderSidebar({ leftMode: 'slim' })
        fireEvent.click(screen.getByRole('button', { name: 'acme' }))
        expect(onSelectOrg).toHaveBeenCalledWith('acme')
    })

    it('the rail All Organizations button calls onSelectOrg(null)', () => {
        const { onSelectOrg } = renderSidebar({ leftMode: 'slim' })
        fireEvent.click(screen.getByRole('button', { name: /all organizations/i }))
        expect(onSelectOrg).toHaveBeenCalledWith(null)
    })

    it('the expand button opens the overlay; selecting an org closes it and calls onSelectOrg', async () => {
        const { onSelectOrg } = renderSidebar({ leftMode: 'slim' })
        expect(screen.queryByTestId('org-panel')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: /expand organization panel/i }))
        expect(await screen.findByTestId('org-panel')).toBeInTheDocument()
        fireEvent.click(screen.getByText('op-acme'))
        expect(onSelectOrg).toHaveBeenCalledWith('acme')
        await waitFor(() => expect(screen.queryByTestId('org-panel')).toBeNull())
    })

    it('closes the overlay on Escape', async () => {
        renderSidebar({ leftMode: 'slim' })
        fireEvent.click(screen.getByRole('button', { name: /expand organization panel/i }))
        expect(await screen.findByTestId('org-panel')).toBeInTheDocument()
        act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
        await waitFor(() => expect(screen.queryByTestId('org-panel')).toBeNull())
    })

    it('does not render the overlay in expanded mode even if toggled (rail is the only opener)', () => {
        // In expanded mode there is no expand button, so the overlay can't open.
        renderSidebar({ leftMode: 'expanded' })
        expect(screen.queryByRole('button', { name: /expand organization panel/i })).toBeNull()
        // Exactly one OrgPanel (the expanded one), never a second overlay copy.
        expect(screen.getAllByTestId('org-panel')).toHaveLength(1)
    })
})
