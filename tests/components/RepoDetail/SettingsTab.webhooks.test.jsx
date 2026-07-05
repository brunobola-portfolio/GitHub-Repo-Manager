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

const sampleWebhooks = [
    { id: 1, active: true, config: { url: 'https://example.com/active-hook' } },
    { id: 2, active: false, config: { url: 'https://example.com/idle-hook' } },
]

function makeProps(overrides = {}) {
    return {
        owner: 'o',
        repo: 'r',
        api: {
            fetchWebhooks: vi.fn().mockResolvedValue(sampleWebhooks),
            deleteWebhook: vi.fn().mockResolvedValue(undefined),
            pingWebhook: vi.fn().mockResolvedValue(undefined),
        },
        repoData: baseRepoData,
        onUpdate: vi.fn(),
        ...overrides,
    }
}

beforeEach(() => {
    vi.clearAllMocks()
    useAIStatus.mockReturnValue({ configured: true, loading: false })
})

describe('SettingsTab — webhook row accessibility', () => {
    async function loadHooks(props) {
        render(<SettingsTab {...props} />)
        fireEvent.click(screen.getByRole('button', { name: /load webhooks/i }))
        await waitFor(() =>
            expect(screen.getByText('https://example.com/active-hook')).toBeInTheDocument(),
        )
    }

    it('gives icon-only ping and delete buttons specific accessible names', async () => {
        await loadHooks(makeProps())

        expect(
            screen.getByRole('button', { name: 'Delete webhook https://example.com/active-hook' }),
        ).toBeInTheDocument()
        expect(
            screen.getByRole('button', { name: 'Ping webhook https://example.com/active-hook' }),
        ).toBeInTheDocument()
    })

    it('conveys active/inactive state as text, not color alone', async () => {
        await loadHooks(makeProps())

        expect(screen.getByRole('img', { name: 'Webhook active' })).toBeInTheDocument()
        expect(screen.getByRole('img', { name: 'Webhook inactive' })).toBeInTheDocument()
    })
})
