import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentRulesModal } from '../../../src/components/AI/AgentRulesModal.jsx'

vi.mock('../../../src/hooks/useTheme', () => ({
    useTheme: () => ({ isDark: false }),
}))

vi.mock('@git-diff-view/react', () => ({
    DiffModeEnum: { Unified: 'unified', Split: 'split' },
    DiffView: ({ data }) => (
        <pre data-testid={`diff-view-${data?.newFile?.fileName}`}>{data?.oldFile?.content}\n---\n{data?.newFile?.content}</pre>
    ),
}))
vi.mock('@git-diff-view/react/styles/diff-view.css', () => ({}))

vi.mock('../../../src/api/ai', () => ({
    aiApi: {
        agentRules: {
            generate: vi.fn(),
            commit: vi.fn(),
        },
    },
}))

import { aiApi } from '../../../src/api/ai'

const REPO = {
    id: 1,
    name: 'lib',
    full_name: 'acme/lib',
    owner: { login: 'acme' },
    language: 'JavaScript',
}

const AI_RESULT = {
    success: true,
    deterministic: false,
    files: { 'AGENTS.md': '## Setup commands\n- Install dependencies: `npm ci`\n' },
    existing: {},
    notes: [],
}

const DETERMINISTIC_RESULT = {
    success: true,
    deterministic: true,
    reason: 'ai_not_configured',
    files: { 'AGENTS.md': '# AGENTS.md\n\n> Deterministic template — generated directly from detected repo signals (no AI).\n' },
    existing: {},
    notes: [],
}

beforeEach(() => {
    aiApi.agentRules.generate.mockReset()
    aiApi.agentRules.commit.mockReset()
})

describe('AgentRulesModal — configure stage', () => {
    it('renders the config panel with AGENTS.md only selected by default', () => {
        render(<AgentRulesModal isOpen repo={REPO} onClose={() => {}} />)
        expect(screen.getByRole('button', { name: /^generate$/i })).toBeInTheDocument()
        expect(screen.getByText(/AGENTS\.md only/i)).toBeInTheDocument()
    })

    it('defaults to refresh mode when the repo already has an AGENTS.md', () => {
        render(<AgentRulesModal isOpen repo={REPO} hasExistingAgents onClose={() => {}} />)
        expect(screen.getByText(/refresh existing/i)).toBeInTheDocument()
    })
})

describe('AgentRulesModal — AI-grounded generate + preview', () => {
    it('walks configure → generate → diff preview, labelled AI-grounded', async () => {
        const user = userEvent.setup()
        aiApi.agentRules.generate.mockResolvedValue(AI_RESULT)

        render(<AgentRulesModal isOpen repo={REPO} onClose={() => {}} />)
        await user.click(screen.getByRole('button', { name: /^generate$/i }))

        await waitFor(() => expect(aiApi.agentRules.generate).toHaveBeenCalledTimes(1))
        const [owner, repo, config] = aiApi.agentRules.generate.mock.calls[0]
        expect(owner).toBe('acme')
        expect(repo).toBe('lib')
        expect(config.targetFiles).toEqual(['AGENTS.md'])

        expect(screen.getByText(/AI-grounded/i)).toBeInTheDocument()
        expect(await screen.findByTestId('diff-view-AGENTS.md (generated)')).toHaveTextContent('npm ci')
        expect(screen.getByRole('button', { name: /^commit$/i })).toBeInTheDocument()
    })

    it('never fabricates a command that was not detected — no test command shown as fact', async () => {
        const user = userEvent.setup()
        aiApi.agentRules.generate.mockResolvedValue({
            ...AI_RESULT,
            files: { 'AGENTS.md': '## Testing instructions\n- No test command was detected — add one here.\n' },
        })
        render(<AgentRulesModal isOpen repo={REPO} onClose={() => {}} />)
        await user.click(screen.getByRole('button', { name: /^generate$/i }))
        expect(await screen.findByTestId('diff-view-AGENTS.md (generated)')).toHaveTextContent('No test command was detected')
    })
})

describe('AgentRulesModal — deterministic no-AI fallback (Addendum 6b.2)', () => {
    it('labels the output as a deterministic template and explains why, never presenting it as AI-written', async () => {
        const user = userEvent.setup()
        aiApi.agentRules.generate.mockResolvedValue(DETERMINISTIC_RESULT)

        render(<AgentRulesModal isOpen repo={REPO} onClose={() => {}} />)
        await user.click(screen.getByRole('button', { name: /^generate$/i }))

        expect(await screen.findByText(/deterministic template \(no ai polish\)/i)).toBeInTheDocument()
        expect(screen.getByText(/AI is not configured/i)).toBeInTheDocument()
        expect(screen.queryByText(/AI-grounded/i)).not.toBeInTheDocument()
    })

    it('still ships a usable deterministic preview when the AI quota is exceeded (429)', async () => {
        const user = userEvent.setup()
        const quotaError = new Error('Agent Rules limit reached')
        quotaError.status = 429
        quotaError.tierError = true
        quotaError.deterministic = true
        quotaError.files = DETERMINISTIC_RESULT.files
        quotaError.existing = {}
        quotaError.notes = []
        aiApi.agentRules.generate.mockRejectedValue(quotaError)

        render(<AgentRulesModal isOpen repo={REPO} onClose={() => {}} />)
        await user.click(screen.getByRole('button', { name: /^generate$/i }))

        expect(await screen.findByTestId('diff-view-AGENTS.md (generated)')).toBeInTheDocument()
        expect(screen.getByText(/deterministic template \(no ai polish\)/i)).toBeInTheDocument()
    })

    it('surfaces a retryable error state for a genuine transport failure (not a quota/AI-availability case)', async () => {
        const user = userEvent.setup()
        aiApi.agentRules.generate.mockRejectedValue(new Error('network down'))

        render(<AgentRulesModal isOpen repo={REPO} onClose={() => {}} />)
        await user.click(screen.getByRole('button', { name: /^generate$/i }))

        expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument()
    })
})

describe('AgentRulesModal — commit flow', () => {
    it('never auto-commits — Commit requires an explicit click and posts every generated file', async () => {
        const user = userEvent.setup()
        aiApi.agentRules.generate.mockResolvedValue(AI_RESULT)
        aiApi.agentRules.commit.mockResolvedValue({
            committed: true,
            results: [{ filePath: 'AGENTS.md', mode: 'direct', branch: 'main' }],
        })

        render(<AgentRulesModal isOpen repo={REPO} onClose={() => {}} />)
        await user.click(screen.getByRole('button', { name: /^generate$/i }))
        await screen.findByTestId('diff-view-AGENTS.md (generated)')

        expect(aiApi.agentRules.commit).not.toHaveBeenCalled()

        await user.click(screen.getByRole('button', { name: /^commit$/i }))

        await waitFor(() => expect(aiApi.agentRules.commit).toHaveBeenCalledTimes(1))
        const [owner, repo, payload] = aiApi.agentRules.commit.mock.calls[0]
        expect(owner).toBe('acme')
        expect(repo).toBe('lib')
        expect(payload.files).toEqual([
            { filePath: 'AGENTS.md', content: AI_RESULT.files['AGENTS.md'], commitMessage: expect.any(String) },
        ])
        expect(payload.mode).toBe('direct')

        expect(await screen.findByText(/agent rules updated/i)).toBeInTheDocument()
    })

    it('commits both AGENTS.md and CLAUDE.md when "AGENTS.md + CLAUDE.md" is selected', async () => {
        const user = userEvent.setup()
        aiApi.agentRules.generate.mockResolvedValue({
            ...AI_RESULT,
            files: { 'AGENTS.md': '## Setup commands\n- npm ci\n', 'CLAUDE.md': '@AGENTS.md\n' },
        })
        aiApi.agentRules.commit.mockResolvedValue({
            committed: true,
            results: [
                { filePath: 'AGENTS.md', mode: 'direct', branch: 'main' },
                { filePath: 'CLAUDE.md', mode: 'direct', branch: 'main' },
            ],
        })

        render(<AgentRulesModal isOpen repo={REPO} onClose={() => {}} />)
        await user.click(screen.getByLabelText(/target file/i))
        await user.click(await screen.findByText(/AGENTS\.md \+ CLAUDE\.md/i))
        await user.click(screen.getByRole('button', { name: /^generate$/i }))

        await waitFor(() => expect(aiApi.agentRules.generate).toHaveBeenCalledTimes(1))
        expect(aiApi.agentRules.generate.mock.calls[0][2].targetFiles).toEqual(['AGENTS.md', 'CLAUDE.md'])

        await screen.findByTestId('diff-view-AGENTS.md (generated)')
        await screen.findByTestId('diff-view-CLAUDE.md (generated)')

        await user.click(screen.getByRole('button', { name: /^commit$/i }))
        await waitFor(() => expect(aiApi.agentRules.commit).toHaveBeenCalledTimes(1))
        const [, , payload] = aiApi.agentRules.commit.mock.calls[0]
        expect(payload.files.map((f) => f.filePath)).toEqual(['AGENTS.md', 'CLAUDE.md'])
    })

    it('opens a PR-fallback and surfaces the PR link when the default branch is protected', async () => {
        const user = userEvent.setup()
        aiApi.agentRules.generate.mockResolvedValue(AI_RESULT)
        aiApi.agentRules.commit.mockResolvedValue({
            committed: true,
            results: [{ filePath: 'AGENTS.md', mode: 'pr-fallback', branch: 'chore/agent-rules-1', prUrl: 'https://github.com/acme/lib/pull/9' }],
        })

        render(<AgentRulesModal isOpen repo={REPO} onClose={() => {}} />)
        await user.click(screen.getByRole('button', { name: /^generate$/i }))
        await screen.findByTestId('diff-view-AGENTS.md (generated)')
        await user.click(screen.getByRole('button', { name: /^commit$/i }))

        expect(await screen.findByText(/agent rules updated/i)).toBeInTheDocument()
        expect(screen.getByRole('link', { name: /view pr/i })).toHaveAttribute('href', 'https://github.com/acme/lib/pull/9')
    })
})
