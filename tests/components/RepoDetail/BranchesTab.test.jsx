import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BranchesTab } from '@/components/RepoDetail/BranchesTab'
import { renderWithProviders } from '../../helpers/render-with-providers'

const sampleBranches = [
    { name: 'main', commit: { sha: 'abc1234deadbeef' }, protected: true },
    { name: 'feature/widget', commit: { sha: 'def5678deadbeef' }, protected: false }
]

function makeApi(overrides = {}) {
    return {
        fetchBranches: vi.fn().mockResolvedValue({ data: sampleBranches }),
        createBranch: vi.fn().mockResolvedValue({ ref: 'refs/heads/new-branch' }),
        deleteBranch: vi.fn().mockResolvedValue(undefined),
        ...overrides
    }
}

afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
})

describe('BranchesTab — toast feedback', () => {
    it('fires a success toast when a branch is created', async () => {
        const user = userEvent.setup()
        const api = makeApi()
        renderWithProviders(<BranchesTab api={api} />)

        await waitFor(() =>
            expect(screen.getByText(/2 Branches/)).toBeInTheDocument()
        )

        await user.click(screen.getByRole('button', { name: /New Branch/i }))
        await user.type(screen.getByPlaceholderText('feature/my-branch'), 'feature/new')
        await user.click(screen.getByRole('button', { name: /^Create$/i }))

        await waitFor(() =>
            expect(api.createBranch).toHaveBeenCalledWith('feature/new', 'abc1234deadbeef')
        )
        // Toast visible in the <ToastContainer>
        expect(await screen.findByText('Branch created')).toBeInTheDocument()
    })
})
