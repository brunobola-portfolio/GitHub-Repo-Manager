import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/hooks/useAIStatus', () => ({ useAIStatus: vi.fn() }))
vi.mock('@/hooks/useModal', () => ({ useModal: () => ({ openModalWithData: vi.fn() }) }))
vi.mock('@/api/ai', () => ({
    aiApi: { getMetadata: vi.fn() },
}))
vi.mock('@/api/repos', () => ({
    reposApi: { setTopics: vi.fn() },
}))
vi.mock('@/hooks/useToast', () => ({
    useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), errorFromException: vi.fn() } }),
}))

import { useAIStatus } from '@/hooks/useAIStatus'
import { aiApi } from '@/api/ai'
import { reposApi } from '@/api/repos'
import { SettingsTab } from '@/components/RepoDetail/SettingsTab'

const baseRepoData = {
    id: 42,
    name: 'r',
    full_name: 'o/r',
    description: 'desc',
    homepage: '',
    has_issues: true,
    has_projects: true,
    has_wiki: true,
    allow_forking: true,
    default_branch: 'main',
    topics: ['react'],
    archived: false,
}

const baseProps = {
    owner: 'o',
    repo: 'r',
    api: {},
    repoData: baseRepoData,
    onUpdate: vi.fn(),
}

beforeEach(() => {
    vi.clearAllMocks()
    useAIStatus.mockReturnValue({ configured: true, loading: false })
})

describe('SettingsTab — AI-suggested topics', () => {
    it('renders a "Suggest topics" button initially', () => {
        render(<SettingsTab {...baseProps} />)
        expect(screen.getByRole('button', { name: /suggest topics/i })).toBeInTheDocument()
    })

    it('shows suggestions filtered against existing topics after Suggest click', async () => {
        aiApi.getMetadata.mockResolvedValue({
            topics: ['react', 'ui-library', 'typescript'],
            health_score: 72,
        })
        render(<SettingsTab {...baseProps} />)
        fireEvent.click(screen.getByRole('button', { name: /suggest topics/i }))
        await waitFor(() => {
            expect(screen.getByLabelText(/ui-library/i)).toBeInTheDocument()
            expect(screen.getByLabelText(/typescript/i)).toBeInTheDocument()
            expect(screen.queryByLabelText(/^react$/i)).not.toBeInTheDocument()
        })
    })

    it('shows the "Looks good" empty state when no new suggestions remain', async () => {
        aiApi.getMetadata.mockResolvedValue({
            topics: ['react'],
            health_score: 72,
        })
        render(<SettingsTab {...baseProps} />)
        fireEvent.click(screen.getByRole('button', { name: /suggest topics/i }))
        await waitFor(() => {
            expect(screen.getByText(/looks good/i)).toBeInTheDocument()
        })
    })

    it('shows the "not indexed" state when metadata returns 404', async () => {
        const err = new Error('404')
        err.status = 404
        aiApi.getMetadata.mockRejectedValue(err)
        render(<SettingsTab {...baseProps} />)
        fireEvent.click(screen.getByRole('button', { name: /suggest topics/i }))
        await waitFor(() => {
            expect(screen.getByText(/not indexed/i)).toBeInTheDocument()
        })
    })

    it('disables the Suggest button when AI is not configured', () => {
        useAIStatus.mockReturnValue({ configured: false, loading: false })
        render(<SettingsTab {...baseProps} />)
        expect(screen.getByRole('button', { name: /suggest topics/i })).toBeDisabled()
    })

    it('applies selected topics as union with existing on apply click', async () => {
        aiApi.getMetadata.mockResolvedValue({
            topics: ['react', 'typescript', 'ui-library'],
            health_score: 72,
        })
        reposApi.setTopics.mockResolvedValue({ names: ['react', 'typescript'] })
        render(<SettingsTab {...baseProps} />)
        fireEvent.click(screen.getByRole('button', { name: /suggest topics/i }))
        const checkbox = await screen.findByLabelText(/typescript/i)
        fireEvent.click(checkbox)
        const applyBtn = screen.getByRole('button', { name: /add 1 topic/i })
        fireEvent.click(applyBtn)
        await waitFor(() => {
            expect(reposApi.setTopics).toHaveBeenCalledWith('o', 'r', expect.arrayContaining(['react', 'typescript']))
        })
    })
})
