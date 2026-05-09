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
