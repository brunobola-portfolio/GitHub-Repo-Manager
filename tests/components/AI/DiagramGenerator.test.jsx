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

    it('never auto-commits — there is no commit/apply/PR action anywhere in the modal', async () => {
        const user = userEvent.setup()
        await generateAndRender(user)

        expect(screen.queryByRole('button', { name: /^apply$/i })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /open pr/i })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /commit/i })).not.toBeInTheDocument()
    })
})
