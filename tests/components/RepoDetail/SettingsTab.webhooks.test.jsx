import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Hoisted so the same spy instance backs every render across this file's
// tests — `vi.mock` factories run fresh on every `useToast()` call, and a
// brand-new `vi.fn()` per call would make `toastMock.errorFromException`
// unassertable from the test body below.
const { toastMock } = vi.hoisted(() => ({
    toastMock: { success: vi.fn(), error: vi.fn(), errorFromException: vi.fn() },
}))

vi.mock('@/hooks/useAIStatus', () => ({ useAIStatus: vi.fn() }))
vi.mock('@/hooks/useModal', () => ({ useModal: () => ({ openModalWithData: vi.fn() }) }))
vi.mock('@/api/ai', () => ({
    aiApi: { getMetadata: vi.fn() },
}))
vi.mock('@/api/repos', () => ({
    reposApi: { setTopics: vi.fn() },
}))
vi.mock('@/hooks/useToast', () => ({
    useToast: () => ({ toast: toastMock }),
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

describe('SettingsTab — webhook load failure', () => {
    it('surfaces a toast when loading webhooks fails, instead of failing silently', async () => {
        const props = makeProps({
            api: {
                fetchWebhooks: vi.fn().mockRejectedValue(new Error('network down')),
                deleteWebhook: vi.fn(),
                pingWebhook: vi.fn(),
            },
        })
        render(<SettingsTab {...props} />)
        fireEvent.click(screen.getByRole('button', { name: /load webhooks/i }))

        await waitFor(() =>
            expect(toastMock.errorFromException).toHaveBeenCalledWith(
                expect.any(Error),
                expect.objectContaining({ fallbackTitle: 'Failed to load webhooks' }),
            ),
        )
    })
})
