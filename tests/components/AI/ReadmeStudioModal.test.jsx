import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReadmeStudioModal } from '../../../src/components/AI/ReadmeStudioModal.jsx'

vi.mock('../../../src/hooks/useTheme', () => ({
    useTheme: () => ({ isDark: false }),
}))

vi.mock('@git-diff-view/react', () => ({
    DiffModeEnum: { Unified: 'unified', Split: 'split' },
    DiffView: ({ data, diffViewMode }) => (
        <pre data-testid="diff-view" data-diff-mode={diffViewMode}>{data?.oldFile?.content}\n---\n{data?.newFile?.content}</pre>
    ),
}))
vi.mock('@git-diff-view/react/styles/diff-view.css', () => ({}))

vi.mock('../../../src/api/ai', () => ({
    aiApi: {
        readmeStudio: {
            getScore: vi.fn(),
            improve: vi.fn(),
            deterministic: vi.fn(),
        },
    },
}))

vi.mock('../../../src/utils/api', () => ({
    getCsrfToken: vi.fn().mockResolvedValue('csrf-token'),
}))

vi.mock('../../../src/api/repos', () => ({
    commitCommunityHealthFix: vi.fn(),
}))

import { aiApi } from '../../../src/api/ai'
import { commitCommunityHealthFix } from '../../../src/api/repos'

const REPO = {
    id: 1,
    name: 'lib',
    full_name: 'acme/lib',
    owner: { login: 'acme' },
    language: 'JavaScript',
    topics: ['tool'],
}

const SCORE_WITH_README = {
    success: true,
    hasReadme: true,
    hasLicense: true,
    report: {
        score: 62,
        summary: 'Decent foundation. Consider adding documentation and tests.',
        patterns: { licenseDetected: { spdxId: 'MIT', matched: true, confidence: 'high' } },
        recommendations: [
            { priority: 'high', action: 'Add usage examples to README' },
            { priority: 'low', action: 'Add status badges to README' },
        ],
    },
}

const SCORE_NO_README = {
    success: true,
    hasReadme: false,
    hasLicense: false,
    report: {
        score: 0,
        summary: 'Needs attention. Focus on documentation and community standards.',
        patterns: {},
        recommendations: [{ priority: 'high', action: 'Add installation instructions to README' }],
    },
}

const IMPROVE_RESULT = {
    success: true,
    markdown: '## Usage\n\nRun it.\n',
    confidence: 'high',
    warnings: [],
    missingSections: ['Usage'],
    mode: 'missing-sections',
    currentReadme: '# lib\n',
}

beforeEach(() => {
    aiApi.readmeStudio.getScore.mockReset()
    aiApi.readmeStudio.improve.mockReset()
    aiApi.readmeStudio.deterministic.mockReset()
    commitCommunityHealthFix.mockReset()
    global.fetch = vi.fn()
})

describe('ReadmeStudioModal — score stage', () => {
    it('loads and renders the score + recommendations on open', async () => {
        aiApi.readmeStudio.getScore.mockResolvedValue(SCORE_WITH_README)
        render(<ReadmeStudioModal isOpen repo={REPO} onClose={() => {}} />)

        await waitFor(() => expect(aiApi.readmeStudio.getScore).toHaveBeenCalledWith('acme', 'lib'))
        expect(await screen.findByText(/Decent foundation/i)).toBeInTheDocument()
        expect(screen.getByText(/Add usage examples to README/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /improve with ai/i })).toBeInTheDocument()
    })

    it('shows a "no README" empty state and skips the recommendations list', async () => {
        aiApi.readmeStudio.getScore.mockResolvedValue(SCORE_NO_README)
        render(<ReadmeStudioModal isOpen repo={REPO} onClose={() => {}} />)

        expect(await screen.findByText(/no readme found/i)).toBeInTheDocument()
    })

    it('shows a retryable error state when the score fetch fails', async () => {
        aiApi.readmeStudio.getScore.mockRejectedValue(new Error('boom'))
        render(<ReadmeStudioModal isOpen repo={REPO} onClose={() => {}} />)

        await waitFor(() => expect(aiApi.readmeStudio.getScore).toHaveBeenCalledTimes(1))
        expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    })

    it('never calls the metered improve endpoint just by opening', async () => {
        aiApi.readmeStudio.getScore.mockResolvedValue(SCORE_WITH_README)
        render(<ReadmeStudioModal isOpen repo={REPO} onClose={() => {}} />)
        await waitFor(() => expect(aiApi.readmeStudio.getScore).toHaveBeenCalled())
        expect(aiApi.readmeStudio.improve).not.toHaveBeenCalled()
    })

    it('renders the footer through ModalFooter — right-aligned with a gap between sibling buttons', async () => {
        aiApi.readmeStudio.getScore.mockResolvedValue(SCORE_WITH_README)
        render(<ReadmeStudioModal isOpen repo={REPO} onClose={() => {}} />)

        const improveButton = await screen.findByRole('button', { name: /improve with ai/i })
        const footer = improveButton.parentElement
        expect(footer.className).toMatch(/justify-end/)
        expect(footer.className).toMatch(/gap-3/)
    })
})

describe('ReadmeStudioModal — improve + preview flow', () => {
    it('walks configure → generate → diff preview', async () => {
        const user = userEvent.setup()
        aiApi.readmeStudio.getScore.mockResolvedValue(SCORE_WITH_README)
        aiApi.readmeStudio.improve.mockResolvedValue(IMPROVE_RESULT)

        render(<ReadmeStudioModal isOpen repo={REPO} onClose={() => {}} />)
        await screen.findByText(/Decent foundation/i)

        await user.click(screen.getByRole('button', { name: /improve with ai/i }))
        expect(screen.getByRole('button', { name: /^generate$/i })).toBeInTheDocument()

        await user.click(screen.getByRole('button', { name: /^generate$/i }))

        await waitFor(() => expect(aiApi.readmeStudio.improve).toHaveBeenCalledTimes(1))
        const [repoArg] = aiApi.readmeStudio.improve.mock.calls[0]
        expect(repoArg.full_name).toBe('acme/lib')

        expect(await screen.findByTestId('diff-view')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /^apply$/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /open pr/i })).toBeInTheDocument()
    })

    it('surfaces a friendly error and lets the user retry when generation fails', async () => {
        const user = userEvent.setup()
        aiApi.readmeStudio.getScore.mockResolvedValue(SCORE_WITH_README)
        aiApi.readmeStudio.improve.mockRejectedValueOnce(new Error('provider down'))
        aiApi.readmeStudio.improve.mockResolvedValueOnce(IMPROVE_RESULT)

        render(<ReadmeStudioModal isOpen repo={REPO} onClose={() => {}} />)
        await screen.findByText(/Decent foundation/i)
        await user.click(screen.getByRole('button', { name: /improve with ai/i }))
        await user.click(screen.getByRole('button', { name: /^generate$/i }))

        await waitFor(() => expect(aiApi.readmeStudio.improve).toHaveBeenCalledTimes(1))
        // AIErrorState never renders the raw error message (formatUserError
        // maps unknown codes to a generic, safe fallback) — assert on that.
        expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()

        await user.click(screen.getByRole('button', { name: /retry/i }))
        await waitFor(() => expect(aiApi.readmeStudio.improve).toHaveBeenCalledTimes(2))
        expect(await screen.findByTestId('diff-view')).toBeInTheDocument()
    })

    it('never auto-commits — Apply requires an explicit click and posts to the community-health write path', async () => {
        const user = userEvent.setup()
        aiApi.readmeStudio.getScore.mockResolvedValue(SCORE_WITH_README)
        aiApi.readmeStudio.improve.mockResolvedValue(IMPROVE_RESULT)
        commitCommunityHealthFix.mockResolvedValue({ committed: true, mode: 'direct', branch: 'main' })

        render(<ReadmeStudioModal isOpen repo={REPO} onClose={() => {}} />)
        await screen.findByText(/Decent foundation/i)
        await user.click(screen.getByRole('button', { name: /improve with ai/i }))
        await user.click(screen.getByRole('button', { name: /^generate$/i }))
        await screen.findByTestId('diff-view')

        // No write happened yet — the commit-fix path hasn't been called.
        expect(commitCommunityHealthFix).not.toHaveBeenCalled()

        await user.click(screen.getByRole('button', { name: /^apply$/i }))

        await waitFor(() => expect(commitCommunityHealthFix).toHaveBeenCalledTimes(1))
        const arg = commitCommunityHealthFix.mock.calls[0][0]
        expect(arg.owner).toBe('acme')
        expect(arg.repo).toBe('lib')
        expect(arg.filePath).toBe('README.md')
        expect(arg.mode).toBe('direct')
        expect(arg.content).toContain('## Usage')

        expect(await screen.findByText(/readme updated/i)).toBeInTheDocument()
    })

    it('opens a PR instead of a direct commit when "Open PR" is clicked', async () => {
        const user = userEvent.setup()
        aiApi.readmeStudio.getScore.mockResolvedValue(SCORE_WITH_README)
        aiApi.readmeStudio.improve.mockResolvedValue(IMPROVE_RESULT)
        commitCommunityHealthFix.mockResolvedValue({ committed: true, mode: 'pr', branch: 'chore/x', prUrl: 'https://github.com/acme/lib/pull/1' })

        render(<ReadmeStudioModal isOpen repo={REPO} onClose={() => {}} />)
        await screen.findByText(/Decent foundation/i)
        await user.click(screen.getByRole('button', { name: /improve with ai/i }))
        await user.click(screen.getByRole('button', { name: /^generate$/i }))
        await screen.findByTestId('diff-view')

        await user.click(screen.getByRole('button', { name: /open pr/i }))

        await waitFor(() => expect(commitCommunityHealthFix).toHaveBeenCalledTimes(1))
        expect(commitCommunityHealthFix.mock.calls[0][0].mode).toBe('pr')
        expect(await screen.findByText(/pull request opened/i)).toBeInTheDocument()
        expect(screen.getByRole('link', { name: /view pr/i })).toHaveAttribute('href', 'https://github.com/acme/lib/pull/1')
    })

    it('shows AI-not-configured guidance instead of a fake diff when AI is unconfigured', async () => {
        const user = userEvent.setup()
        aiApi.readmeStudio.getScore.mockResolvedValue(SCORE_WITH_README)
        aiApi.readmeStudio.improve.mockResolvedValue({
            success: true, markdown: null, confidence: 'low', warnings: [], missingSections: [],
            mode: 'missing-sections', currentReadme: null, mock: true, aiConfigured: false,
        })

        render(<ReadmeStudioModal isOpen repo={REPO} onClose={() => {}} />)
        await screen.findByText(/Decent foundation/i)
        await user.click(screen.getByRole('button', { name: /improve with ai/i }))
        await user.click(screen.getByRole('button', { name: /^generate$/i }))

        expect(await screen.findByText(/ai is not configured/i)).toBeInTheDocument()
        expect(screen.queryByTestId('diff-view')).not.toBeInTheDocument()
    })
})

describe('ReadmeStudioModal — deterministic fallback (Addendum 6b.2)', () => {
    const DETERMINISTIC_RESULT = {
        success: true,
        deterministic: true,
        markdown: '## License\n\nThis project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.',
        sections: ['License'],
        mode: 'missing-sections',
        missingSections: ['License'],
        currentReadme: '# lib\n',
    }

    it('offers a deterministic patch when no AI provider is configured, and applies it', async () => {
        const user = userEvent.setup()
        aiApi.readmeStudio.getScore.mockResolvedValue(SCORE_WITH_README)
        aiApi.readmeStudio.improve.mockResolvedValue({
            success: true, markdown: null, confidence: 'low', warnings: [], missingSections: [],
            mode: 'missing-sections', currentReadme: null, mock: true, aiConfigured: false,
        })
        aiApi.readmeStudio.deterministic.mockResolvedValue(DETERMINISTIC_RESULT)

        render(<ReadmeStudioModal isOpen repo={REPO} onClose={() => {}} />)
        await screen.findByText(/Decent foundation/i)
        await user.click(screen.getByRole('button', { name: /improve with ai/i }))
        await user.click(screen.getByRole('button', { name: /^generate$/i }))

        expect(await screen.findByText(/ai is not configured/i)).toBeInTheDocument()
        const fallbackBtn = screen.getByRole('button', { name: /use deterministic version instead/i })

        await user.click(fallbackBtn)

        await waitFor(() => expect(aiApi.readmeStudio.deterministic).toHaveBeenCalledTimes(1))
        expect(await screen.findByText(/deterministic \(no ai\)/i)).toBeInTheDocument()
        expect(await screen.findByTestId('diff-view')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /^apply$/i })).toBeInTheDocument()
    })

    it('offers the deterministic patch when the AI call is quota-exceeded (429)', async () => {
        const user = userEvent.setup()
        aiApi.readmeStudio.getScore.mockResolvedValue(SCORE_WITH_README)
        const quotaErr = Object.assign(new Error('AI query limit exceeded'), { status: 429, tierError: true })
        aiApi.readmeStudio.improve.mockRejectedValue(quotaErr)
        aiApi.readmeStudio.deterministic.mockResolvedValue(DETERMINISTIC_RESULT)

        render(<ReadmeStudioModal isOpen repo={REPO} onClose={() => {}} />)
        await screen.findByText(/Decent foundation/i)
        await user.click(screen.getByRole('button', { name: /improve with ai/i }))
        await user.click(screen.getByRole('button', { name: /^generate$/i }))

        await waitFor(() => expect(aiApi.readmeStudio.improve).toHaveBeenCalledTimes(1))
        const fallbackBtn = await screen.findByRole('button', { name: /use deterministic version instead/i })

        await user.click(fallbackBtn)

        await waitFor(() => expect(aiApi.readmeStudio.deterministic).toHaveBeenCalledTimes(1))
        expect(await screen.findByTestId('diff-view')).toBeInTheDocument()
    })
})

describe('ReadmeStudioModal — responsive diff mode (mobile auto-unified)', () => {
    const realMatchMedia = window.matchMedia

    afterEach(() => {
        window.matchMedia = realMatchMedia
    })

    function mockViewport(isMobile) {
        window.matchMedia = vi.fn((query) => ({
            matches: isMobile,
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }))
    }

    async function openDiffPreview(user) {
        render(<ReadmeStudioModal isOpen repo={REPO} onClose={() => {}} />)
        await screen.findByText(/Decent foundation/i)
        await user.click(screen.getByRole('button', { name: /improve with ai/i }))
        await user.click(screen.getByRole('button', { name: /^generate$/i }))
        return screen.findByTestId('diff-view')
    }

    it('defaults to Split above the md breakpoint (desktop)', async () => {
        mockViewport(false)
        const user = userEvent.setup()
        aiApi.readmeStudio.getScore.mockResolvedValue(SCORE_WITH_README)
        aiApi.readmeStudio.improve.mockResolvedValue(IMPROVE_RESULT)

        const diffView = await openDiffPreview(user)
        expect(diffView).toHaveAttribute('data-diff-mode', 'split')
    })

    it('switches to Unified below the md breakpoint (mobile) — Split would be two ~180px columns', async () => {
        mockViewport(true)
        const user = userEvent.setup()
        aiApi.readmeStudio.getScore.mockResolvedValue(SCORE_WITH_README)
        aiApi.readmeStudio.improve.mockResolvedValue(IMPROVE_RESULT)

        const diffView = await openDiffPreview(user)
        expect(diffView).toHaveAttribute('data-diff-mode', 'unified')
    })
})
