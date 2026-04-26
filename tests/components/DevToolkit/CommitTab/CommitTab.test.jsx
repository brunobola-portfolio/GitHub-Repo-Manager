import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/hooks/useAIStatus', () => ({ useAIStatus: vi.fn() }))
vi.mock('@/hooks/useStreaming', () => ({
    useStreaming: () => ({
        streamingText: '',
        isStreaming: false,
        error: null,
        retryCount: 0,
        startStream: vi.fn(),
        cancelStream: vi.fn(),
    }),
}))

import { useAIStatus } from '@/hooks/useAIStatus'
import { CommitTab } from '@/components/DevToolkit/CommitTab/CommitTab'

const baseToolkit = {
    selectedRepo: { name: 'r', full_name: 'o/r' },
    headBranch: 'feature',
    baseBranch: 'main',
    branches: [{ name: 'main' }, { name: 'feature' }],
    compareData: { diff_summary: { additions: 5, deletions: 2 }, files: [{ filename: 'x.js' }] },
    compareLoading: false,
    handleBranchChange: vi.fn(),
    getDiffText: () => 'diff --git a/x b/x',
    repoOwner: 'o',
    history: [],
    addToHistory: vi.fn(),
    setGeneratedCommit: vi.fn(),
}

describe('CommitTab — AI configured gate', () => {
    it('disables the Generate button with a tooltip when AI is off', () => {
        useAIStatus.mockReturnValue({ configured: false, loading: false })
        render(<CommitTab toolkit={baseToolkit} />)
        const btn = screen.getByRole('button', { name: /generate/i })
        expect(btn).toBeDisabled()
        expect(btn).toHaveAttribute('title', expect.stringContaining('Settings'))
    })

    it('enables the Generate button when AI is configured', () => {
        useAIStatus.mockReturnValue({ configured: true, loading: false })
        render(<CommitTab toolkit={baseToolkit} />)
        const btn = screen.getByRole('button', { name: /generate/i })
        expect(btn).not.toBeDisabled()
    })
})
