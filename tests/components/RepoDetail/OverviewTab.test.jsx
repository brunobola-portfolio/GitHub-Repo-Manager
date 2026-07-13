import { screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OverviewTab } from '@/components/RepoDetail/OverviewTab'
import { renderWithProviders } from '../../helpers/render-with-providers'

// Mock useModal to avoid provider requirements
vi.mock('@/hooks/useModal', () => ({
    useModal: () => ({ openModalWithData: vi.fn() })
}))

const REPO = {
    name: 'demo',
    owner: { login: 'octocat' },
    default_branch: 'main',
    description: '',
    homepage: '',
    archived: false,
}

function makeApi(readmeContent) {
    return {
        fetchReadme: vi.fn().mockResolvedValue({
            data: { content: btoa(readmeContent) },
        }),
        updateRepo: vi.fn(),
    }
}

beforeEach(() => {
    vi.clearAllMocks()
})

describe('OverviewTab — README rendering', () => {
    it('renders a markdown table from the README (not raw <pre>)', async () => {
        const api = makeApi('| h | i |\n|---|---|\n| 1 | 2 |')
        renderWithProviders(<OverviewTab api={api} repoData={REPO} onUpdate={() => {}} />)
        await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
        expect(screen.queryByText('| h | i |')).toBeNull() // raw pipe text must NOT be visible
    })
})

describe('OverviewTab — Topics', () => {
    it('renders each topic as a brand-toned ringed Badge (unified with the RepoDetail header pills)', async () => {
        const api = makeApi('')
        const repoWithTopics = { ...REPO, topics: ['react', 'vite'] }
        renderWithProviders(<OverviewTab api={api} repoData={repoWithTopics} onUpdate={() => {}} />)

        const pill = await screen.findByText('react')
        // Badge's brand tone (see src/components/ui/Badge.jsx TONES.brand) +
        // the `ring` prop's tone-matched inset ring (RINGS.brand).
        expect(pill.className).toMatch(/bg-indigo-100/)
        expect(pill.className).toMatch(/dark:bg-indigo-900\/40/)
        expect(pill.className).toMatch(/ring-1 ring-inset/)
        expect(pill.className).toMatch(/ring-indigo-200/)
        expect(screen.getByText('vite')).toBeInTheDocument()
    })
})
