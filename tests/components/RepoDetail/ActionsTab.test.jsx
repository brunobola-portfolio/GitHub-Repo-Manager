import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { ActionsTab } from '@/components/RepoDetail/ActionsTab'

// Hoisted so the same spy instance backs every render — `vi.mock` factories
// run fresh on every `useToast()` call, and a brand-new `vi.fn()` per call
// would make `toastMock.errorFromException` unassertable below.
const { toastMock } = vi.hoisted(() => ({
    toastMock: { success: vi.fn(), error: vi.fn(), errorFromException: vi.fn() },
}))

vi.mock('@/hooks/useToast', () => ({
    useToast: () => ({ toast: toastMock }),
}))

vi.mock('@/api/repo-actions', () => ({
    repoActionsApi: {
        listWorkflows: vi.fn(),
        listRuns: vi.fn(),
        syncRuns: vi.fn(),
        triggerDispatch: vi.fn(),
    },
}))

import { repoActionsApi } from '@/api/repo-actions'

const repo = { owner: { login: 'owner' }, name: 'repo', full_name: 'owner/repo' }

const sampleWorkflows = [{ id: 1, name: 'CI', state: 'active' }]
const sampleRuns = [
    {
        id: 100,
        workflow_id: 1,
        status: 'completed',
        conclusion: 'success',
        head_branch: 'main',
        event: 'push',
        created_at: '2026-04-10T00:00:00Z',
        run_number: 5,
    },
]

beforeEach(() => {
    vi.clearAllMocks()
    repoActionsApi.listWorkflows.mockResolvedValue(sampleWorkflows)
    repoActionsApi.listRuns.mockResolvedValue(sampleRuns)
})

afterEach(() => {
    cleanup()
})

describe('ActionsTab — sync failure surfaced', () => {
    it('shows an error toast when the manual sync fails, instead of failing silently', async () => {
        repoActionsApi.syncRuns.mockRejectedValue(new Error('sync exploded'))
        render(<ActionsTab repo={repo} />)

        await screen.findByText('CI')

        fireEvent.click(screen.getByRole('button', { name: /^refresh$/i }))

        await waitFor(() =>
            expect(toastMock.errorFromException).toHaveBeenCalledWith(
                expect.any(Error),
                expect.objectContaining({ fallbackTitle: expect.stringMatching(/sync/i) }),
            ),
        )
    })

    it('still reloads workflows/runs after a sync failure', async () => {
        repoActionsApi.syncRuns.mockRejectedValue(new Error('sync exploded'))
        render(<ActionsTab repo={repo} />)

        await screen.findByText('CI')
        fireEvent.click(screen.getByRole('button', { name: /^refresh$/i }))

        await waitFor(() => expect(repoActionsApi.listWorkflows).toHaveBeenCalledTimes(2))
        await waitFor(() => expect(repoActionsApi.listRuns).toHaveBeenCalledTimes(2))
    })
})
