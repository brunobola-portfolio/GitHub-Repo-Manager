import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DiagramGenerator } from '../../../src/components/AI/DiagramGenerator.jsx'

const mermaidRenderMock = vi.fn()
const mermaidInitializeMock = vi.fn()

vi.mock('mermaid', () => ({
    default: {
        initialize: (...args) => mermaidInitializeMock(...args),
        render: (...args) => mermaidRenderMock(...args),
    },
}))

// happy-dom can't run @git-diff-view/react's real canvas-based text
// measurement — mocked to a plain, inspectable stand-in, same approach
// ReadmeStudioModal.test.jsx already established for its own diff preview.
vi.mock('@git-diff-view/react', () => ({
    DiffModeEnum: { Unified: 'unified', Split: 'split' },
    DiffView: ({ data }) => (
        <pre data-testid="diagram-embed-diff">{data?.oldFile?.content}{'\n---\n'}{data?.newFile?.content}</pre>
    ),
}))
vi.mock('@git-diff-view/react/styles/diff-view.css', () => ({}))

// parseAndSanitizeSvg's real implementation runs by default (validates the
// defence-in-depth sanitizer wiring end to end); one test overrides it to
// return null to exercise the "sanitization failure never retries" path
// without depending on happy-dom's lenient DOMParser error reporting.
// vi.hoisted so the mock fn exists before vi.mock's hoisted factory runs.
const { parseAndSanitizeSvgMock } = vi.hoisted(() => ({ parseAndSanitizeSvgMock: vi.fn() }))
vi.mock('../../../src/utils/sanitizeSvg.js', async (orig) => {
    const actual = await orig()
    parseAndSanitizeSvgMock.mockImplementation(actual.parseAndSanitizeSvg)
    return { parseAndSanitizeSvg: (...args) => parseAndSanitizeSvgMock(...args) }
})

vi.mock('../../../src/api/ai', () => ({
    aiApi: {
        diagrams: {
            generate: vi.fn(),
            deterministic: vi.fn(),
            embedPreview: vi.fn(),
            embedCommit: vi.fn(),
        },
    },
}))

// The clipboard util has its own dedicated coverage in tests/utils/clipboard.test.js
// (and happy-dom's real navigator.clipboard isn't reliably stubbable across
// userEvent interactions) — mock it directly so these tests assert on
// DiagramGenerator's behavior (what it copies), not the browser API.
const copyToClipboardMock = vi.fn().mockResolvedValue(true)
vi.mock('../../../src/utils/clipboard.js', () => ({
    copyToClipboard: (...args) => copyToClipboardMock(...args),
}))

const REPO = { id: 1, name: 'lib', full_name: 'acme/lib', owner: { login: 'acme' }, language: 'JavaScript' }

const GENERATE_RESULT = {
    success: true,
    mermaid: 'graph TD\n  A[src] --> B[server]',
    diagramType: 'architecture',
    truncated: false,
}

import { aiApi } from '../../../src/api/ai'

beforeEach(() => {
    aiApi.diagrams.generate.mockReset()
    aiApi.diagrams.deterministic.mockReset()
    aiApi.diagrams.embedPreview.mockReset()
    aiApi.diagrams.embedCommit.mockReset()
    mermaidRenderMock.mockReset()
    mermaidInitializeMock.mockReset()
    mermaidRenderMock.mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>diagram</text></svg>' })
    copyToClipboardMock.mockReset().mockResolvedValue(true)
    global.URL.createObjectURL = vi.fn(() => 'blob:mock')
    global.URL.revokeObjectURL = vi.fn()
})

describe('DiagramGenerator — configure stage', () => {
    it('shows the honesty label before generating', () => {
        render(<DiagramGenerator isOpen repo={REPO} onClose={() => {}} />)
        expect(screen.getByText(/not a verified static-analysis dependency graph/i)).toBeInTheDocument()
    })

    it('only offers the architecture diagram type in v1', () => {
        render(<DiagramGenerator isOpen repo={REPO} onClose={() => {}} />)
        expect(screen.getByText(/architecture \/ module graph/i)).toBeInTheDocument()
    })

    it('never calls the metered generate endpoint just by opening', () => {
        render(<DiagramGenerator isOpen repo={REPO} onClose={() => {}} />)
        expect(aiApi.diagrams.generate).not.toHaveBeenCalled()
    })
})

describe('DiagramGenerator — generate + render', () => {
    it('generates and renders the diagram, passing repo + diagramType to the API', async () => {
        const user = userEvent.setup()
        aiApi.diagrams.generate.mockResolvedValue(GENERATE_RESULT)

        render(<DiagramGenerator isOpen repo={REPO} onClose={() => {}} />)
        await user.click(screen.getByRole('button', { name: /^generate$/i }))

        await waitFor(() => expect(aiApi.diagrams.generate).toHaveBeenCalledTimes(1))
        const [repoArg, config] = aiApi.diagrams.generate.mock.calls[0]
        expect(repoArg.full_name).toBe('acme/lib')
        expect(config.diagramType).toBe('architecture')

        await waitFor(() => expect(mermaidRenderMock).toHaveBeenCalledTimes(1))
        expect(screen.getByTestId('diagram-mermaid-output')).toBeInTheDocument()
        expect(screen.getByText(/not a verified static-analysis dependency graph/i)).toBeInTheDocument()
    })

    it('shows a truncated-listing badge when the server reports a capped tree', async () => {
        const user = userEvent.setup()
        aiApi.diagrams.generate.mockResolvedValue({ ...GENERATE_RESULT, truncated: true })

        render(<DiagramGenerator isOpen repo={REPO} onClose={() => {}} />)
        await user.click(screen.getByRole('button', { name: /^generate$/i }))

        expect(await screen.findByText(/partial \(truncated\) file listing/i)).toBeInTheDocument()
    })

    it('shows AI-not-configured guidance instead of a fake diagram when AI is unconfigured', async () => {
        const user = userEvent.setup()
        aiApi.diagrams.generate.mockResolvedValue({
            success: true, mermaid: null, diagramType: 'architecture', truncated: false,
            mock: true, aiConfigured: false,
        })

        render(<DiagramGenerator isOpen repo={REPO} onClose={() => {}} />)
        await user.click(screen.getByRole('button', { name: /^generate$/i }))

        expect(await screen.findByText(/ai is not configured/i)).toBeInTheDocument()
        expect(mermaidRenderMock).not.toHaveBeenCalled()
    })
})

describe('DiagramGenerator — retry-once self-repair', () => {
    it('silently retries once on a render failure, then renders the repaired diagram', async () => {
        const user = userEvent.setup()
        aiApi.diagrams.generate
            .mockResolvedValueOnce(GENERATE_RESULT) // initial generate
            .mockResolvedValueOnce({ ...GENERATE_RESULT, mermaid: 'graph TD\n  A --> B --> C' }) // retry repair

        mermaidRenderMock
            .mockRejectedValueOnce(new Error('Parse error on line 2'))
            .mockResolvedValueOnce({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>fixed</text></svg>' })

        render(<DiagramGenerator isOpen repo={REPO} onClose={() => {}} />)
        await user.click(screen.getByRole('button', { name: /^generate$/i }))

        await waitFor(() => expect(mermaidRenderMock).toHaveBeenCalledTimes(1))
        await waitFor(() => expect(aiApi.diagrams.generate).toHaveBeenCalledTimes(2))

        const [, retryConfig] = aiApi.diagrams.generate.mock.calls[1]
        expect(retryConfig.retry).toBe(true)
        expect(retryConfig.failedSource).toContain('graph TD')
        expect(retryConfig.parseError).toContain('Parse error')

        await waitFor(() => expect(mermaidRenderMock).toHaveBeenCalledTimes(2))
        expect(screen.queryByText(/diagram failed to render/i)).not.toBeInTheDocument()
        expect(screen.getByTestId('diagram-mermaid-output')).toBeInTheDocument()
    })

    it('shows an inline error + manual Regenerate after the retry also fails, without a third auto-call', async () => {
        const user = userEvent.setup()
        aiApi.diagrams.generate
            .mockResolvedValueOnce(GENERATE_RESULT)
            .mockResolvedValueOnce({ ...GENERATE_RESULT, mermaid: 'graph TD\n  still broken' })

        mermaidRenderMock.mockRejectedValue(new Error('always broken'))

        render(<DiagramGenerator isOpen repo={REPO} onClose={() => {}} />)
        await user.click(screen.getByRole('button', { name: /^generate$/i }))

        await waitFor(() => expect(aiApi.diagrams.generate).toHaveBeenCalledTimes(2))
        await waitFor(() => expect(mermaidRenderMock).toHaveBeenCalledTimes(2))

        expect(await screen.findByText(/diagram failed to render/i)).toBeInTheDocument()
        const regenerateBtn = screen.getByRole('button', { name: /regenerate/i })
        expect(regenerateBtn).toBeInTheDocument()

        // No further automatic retry — still exactly 2 calls until the user acts.
        expect(aiApi.diagrams.generate).toHaveBeenCalledTimes(2)

        // Manual Regenerate is a fresh, fully new request.
        aiApi.diagrams.generate.mockResolvedValueOnce(GENERATE_RESULT)
        mermaidRenderMock.mockResolvedValueOnce({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>ok</text></svg>' })
        await user.click(regenerateBtn)

        await waitFor(() => expect(aiApi.diagrams.generate).toHaveBeenCalledTimes(3))
        const [, freshConfig] = aiApi.diagrams.generate.mock.calls[2]
        expect(freshConfig.retry).toBeUndefined()
    })

    it('never retries on a sanitization failure (parseAndSanitizeSvg returning null)', async () => {
        const user = userEvent.setup()
        aiApi.diagrams.generate.mockResolvedValue(GENERATE_RESULT)
        mermaidRenderMock.mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>diagram</text></svg>' })
        // Simulate the client-side sanitizer tripping — a distinct failure
        // mode from a mermaid parse error, and one that must never retry.
        parseAndSanitizeSvgMock.mockImplementationOnce(() => null)

        render(<DiagramGenerator isOpen repo={REPO} onClose={() => {}} />)
        await user.click(screen.getByRole('button', { name: /^generate$/i }))

        await waitFor(() => expect(mermaidRenderMock).toHaveBeenCalledTimes(1))
        expect(await screen.findByText(/failed to render safely/i)).toBeInTheDocument()
        // Only the initial generate call — sanitization failure never triggers retry.
        expect(aiApi.diagrams.generate).toHaveBeenCalledTimes(1)
    })
})

describe('DiagramGenerator — export actions', () => {
    async function generateAndRender(user) {
        aiApi.diagrams.generate.mockResolvedValue(GENERATE_RESULT)
        render(<DiagramGenerator isOpen repo={REPO} onClose={() => {}} />)
        await user.click(screen.getByRole('button', { name: /^generate$/i }))
        await waitFor(() => expect(mermaidRenderMock).toHaveBeenCalledTimes(1))
        await screen.findByTestId('diagram-mermaid-output')
    }

    it('copies the raw Mermaid source via Copy Mermaid', async () => {
        const user = userEvent.setup()
        await generateAndRender(user)

        await user.click(screen.getByRole('button', { name: /copy mermaid/i }))
        await waitFor(() => expect(copyToClipboardMock).toHaveBeenCalledWith(GENERATE_RESULT.mermaid))
    })

    it('copies the serialized SVG via Copy SVG', async () => {
        const user = userEvent.setup()
        await generateAndRender(user)

        await user.click(screen.getByRole('button', { name: /copy svg/i }))
        await waitFor(() => expect(copyToClipboardMock).toHaveBeenCalledTimes(1))
        expect(copyToClipboardMock.mock.calls[0][0]).toContain('<svg')
    })

    it('downloads an SVG blob via Download SVG', async () => {
        const user = userEvent.setup()
        await generateAndRender(user)

        await user.click(screen.getByRole('button', { name: /download svg/i }))
        expect(global.URL.createObjectURL).toHaveBeenCalledTimes(1)
        const blobArg = global.URL.createObjectURL.mock.calls[0][0]
        expect(blobArg.type).toBe('image/svg+xml')
        expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock')
    })

    it('never auto-commits from the result stage — Apply/Open PR only exist after the explicit embed preview flow', async () => {
        const user = userEvent.setup()
        await generateAndRender(user)

        expect(screen.queryByRole('button', { name: /^apply$/i })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /open pr/i })).not.toBeInTheDocument()
        // "Embed in repo" is the only entry point into a write action, and it
        // only navigates to a config step — nothing is written by this click.
        expect(screen.getByRole('button', { name: /embed in repo/i })).toBeInTheDocument()
        expect(aiApi.diagrams.embedPreview).not.toHaveBeenCalled()
        expect(aiApi.diagrams.embedCommit).not.toHaveBeenCalled()
    })
})

describe('DiagramGenerator — embed in repo (Addendum 6b.1)', () => {
    async function generateAndRender(user) {
        aiApi.diagrams.generate.mockResolvedValue(GENERATE_RESULT)
        render(<DiagramGenerator isOpen repo={REPO} onClose={() => {}} />)
        await user.click(screen.getByRole('button', { name: /^generate$/i }))
        await waitFor(() => expect(mermaidRenderMock).toHaveBeenCalledTimes(1))
        await screen.findByTestId('diagram-mermaid-output')
    }

    const README_PREVIEW = {
        success: true, target: 'readme-mermaid', hasReadme: true, readOnly: false, action: 'inserted', notice: null,
        readme: {
            path: 'README.md',
            before: '# acme/lib\n\nAn intro.',
            after: '# acme/lib\n\nAn intro.\n\n<!-- repo-manager:diagram:architecture:start -->\n```mermaid\ngraph TD\n  A[src] --> B[server]\n```\n<!-- repo-manager:diagram:architecture:end -->',
            commitMessage: 'docs: embed architecture diagram in README',
        },
    }

    it('disables "Embed in repo" until a diagram has successfully rendered', () => {
        render(<DiagramGenerator isOpen repo={REPO} onClose={() => {}} />)
        // Still on the configure stage — no embed button is even reachable yet.
        expect(screen.queryByRole('button', { name: /embed in repo/i })).not.toBeInTheDocument()
    })

    it('walks the full readme-mermaid embed flow: configure → preview (diff) → Apply → committed', async () => {
        const user = userEvent.setup()
        await generateAndRender(user)
        aiApi.diagrams.embedPreview.mockResolvedValue(README_PREVIEW)
        aiApi.diagrams.embedCommit.mockResolvedValue({ success: true, target: 'readme-mermaid', readme: { mode: 'direct', branch: 'main' } })

        await user.click(screen.getByRole('button', { name: /embed in repo/i }))
        expect(screen.getByText(/embed as/i)).toBeInTheDocument()

        await user.click(screen.getByRole('button', { name: /^preview$/i }))
        await waitFor(() => expect(aiApi.diagrams.embedPreview).toHaveBeenCalledTimes(1))
        const [payload] = aiApi.diagrams.embedPreview.mock.calls[0]
        expect(payload.target).toBe('readme-mermaid')
        expect(payload.mermaid).toBe(GENERATE_RESULT.mermaid)

        expect(await screen.findByTestId('diagram-embed-diff')).toBeInTheDocument()

        await user.click(screen.getByRole('button', { name: /^apply$/i }))
        await waitFor(() => expect(aiApi.diagrams.embedCommit).toHaveBeenCalledTimes(1))
        expect(await screen.findByText(/diagram embedded/i)).toBeInTheDocument()
    })

    it('offers to switch to SVG when there is no README to embed a mermaid fence into', async () => {
        const user = userEvent.setup()
        await generateAndRender(user)
        aiApi.diagrams.embedPreview.mockResolvedValue({
            success: true, target: 'readme-mermaid', hasReadme: false, readOnly: false,
            notice: 'No README found — create one first (README Studio), or embed as a committed SVG file instead.',
        })

        await user.click(screen.getByRole('button', { name: /embed in repo/i }))
        await user.click(screen.getByRole('button', { name: /^preview$/i }))

        expect(await screen.findByText(/no readme found/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /switch to committed svg file/i })).toBeInTheDocument()
    })

    it('shows an honest read-only state and disables Apply/Open PR when the user lacks push rights', async () => {
        const user = userEvent.setup()
        await generateAndRender(user)
        aiApi.diagrams.embedPreview.mockResolvedValue({ ...README_PREVIEW, readOnly: true })

        await user.click(screen.getByRole('button', { name: /embed in repo/i }))
        await user.click(screen.getByRole('button', { name: /^preview$/i }))

        expect(await screen.findByText(/don't have push access/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /^apply$/i })).toBeDisabled()
        expect(screen.getByRole('button', { name: /open pr/i })).toBeDisabled()
        expect(aiApi.diagrams.embedCommit).not.toHaveBeenCalled()
    })

    it('surfaces a malformed-marker notice from the preview response', async () => {
        const user = userEvent.setup()
        await generateAndRender(user)
        aiApi.diagrams.embedPreview.mockResolvedValue({
            ...README_PREVIEW,
            action: 'appended-malformed',
            notice: 'Existing diagram markers were malformed (only one of the start/end markers was found) — treated as absent; a fresh block was appended at the end.',
        })

        await user.click(screen.getByRole('button', { name: /embed in repo/i }))
        await user.click(screen.getByRole('button', { name: /^preview$/i }))

        expect(await screen.findByText(/malformed/i)).toBeInTheDocument()
    })

    it('commits the SVG-file target with both svg and readme payloads on Open PR', async () => {
        const user = userEvent.setup()
        await generateAndRender(user)
        aiApi.diagrams.embedPreview.mockResolvedValue({
            success: true, target: 'svg-file', hasReadme: true, readOnly: false,
            svg: { path: 'docs/diagrams/architecture.svg', content: '<svg xmlns="http://www.w3.org/2000/svg"/>', commitMessage: 'docs: add diagram svg' },
            readme: { path: 'README.md', before: '# x', after: '# x\n\n![Architecture diagram](docs/diagrams/architecture.svg)', commitMessage: 'docs: reference diagram svg', notice: null },
            notice: null,
        })
        aiApi.diagrams.embedCommit.mockResolvedValue({
            success: true, target: 'svg-file',
            svg: { mode: 'pr', branch: 'chore/diagram', prUrl: 'https://github.com/acme/lib/pull/9' },
            readme: { mode: 'pr', branch: 'chore/diagram', prUrl: 'https://github.com/acme/lib/pull/9' },
        })

        await user.click(screen.getByRole('button', { name: /embed in repo/i }))
        // Switch target to "Committed SVG file" via the Select component.
        await user.click(screen.getByRole('combobox', { name: /embed as/i }))
        await user.click(await screen.findByRole('option', { name: /committed svg file/i }))

        await user.click(screen.getByRole('button', { name: /^preview$/i }))
        await waitFor(() => expect(aiApi.diagrams.embedPreview).toHaveBeenCalledTimes(1))
        expect(aiApi.diagrams.embedPreview.mock.calls[0][0].target).toBe('svg-file')
        expect(screen.getByTestId('diagram-embed-svg-path')).toBeInTheDocument()

        await user.click(screen.getByRole('button', { name: /open pr/i }))
        await waitFor(() => expect(aiApi.diagrams.embedCommit).toHaveBeenCalledTimes(1))
        const [commitPayload] = aiApi.diagrams.embedCommit.mock.calls[0]
        expect(commitPayload.svg).toBeTruthy()
        expect(commitPayload.readme).toBeTruthy()
        expect(commitPayload.mode).toBe('pr')

        expect(await screen.findByRole('link', { name: /view pr/i })).toBeInTheDocument()
    })
})

describe('DiagramGenerator — deterministic fallback after persistent render failure (Addendum 6b.2)', () => {
    it('offers and applies a deterministic diagram once the retry-once self-repair also fails', async () => {
        const user = userEvent.setup()
        aiApi.diagrams.generate
            .mockResolvedValueOnce(GENERATE_RESULT)
            .mockResolvedValueOnce({ ...GENERATE_RESULT, mermaid: 'graph TD\n  still broken' })
        mermaidRenderMock.mockRejectedValue(new Error('always broken'))

        render(<DiagramGenerator isOpen repo={REPO} onClose={() => {}} />)
        await user.click(screen.getByRole('button', { name: /^generate$/i }))
        await waitFor(() => expect(aiApi.diagrams.generate).toHaveBeenCalledTimes(2))
        expect(await screen.findByText(/diagram failed to render/i)).toBeInTheDocument()

        const fallbackBtn = screen.getByRole('button', { name: /use a deterministic diagram instead|use deterministic diagram instead/i })
        aiApi.diagrams.deterministic.mockResolvedValue({ success: true, mermaid: 'flowchart TD\n  root["repository root"]', diagramType: 'architecture', truncated: false, deterministic: true })
        mermaidRenderMock.mockResolvedValueOnce({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>fallback</text></svg>' })

        await user.click(fallbackBtn)
        await waitFor(() => expect(aiApi.diagrams.deterministic).toHaveBeenCalledTimes(1))
        expect(await screen.findByText(/structure diagram \(deterministic\)/i)).toBeInTheDocument()
        // The diagram now renders (no more render error) and embedding is available.
        expect(screen.getByRole('button', { name: /embed in repo/i })).not.toBeDisabled()
    })
})
