/**
 * usePromptStudio deliberately keeps the whole Error so a consumer can read
 * `err.code` — its own comment says so. PromptStudioPage then rendered it with
 * `{studio.error}`, and React refuses to render an object as a child, so any
 * preset-load failure took the entire page down to the error boundary instead
 * of showing a message about presets.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render as rtlRender, screen } from '@testing-library/react'
import { ToastHarness } from '../../helpers/render-with-providers'
import { ModalProvider } from '../../../src/contexts/ModalContext'

// The page reads ModalContext for its confirm dialog, and ToastHarness is the
// house wrapper — compose rather than widen the shared helper.
const render = (ui) =>
    rtlRender(
        <ToastHarness>
            <ModalProvider>{ui}</ModalProvider>
        </ToastHarness>
    )

const mockStudio = vi.fn()
vi.mock('../../../src/hooks/usePromptStudio', () => ({
    usePromptStudio: () => mockStudio(),
}))

const { PromptStudioPage } = await import('../../../src/components/AIPrompts/PromptStudioPage.jsx')

const studio = (over = {}) => ({
    presets: [],
    loading: false,
    error: null,
    refresh: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    setDefault: vi.fn(),
    ...over,
})

beforeEach(() => {
    mockStudio.mockReset()
})

describe('PromptStudioPage — a failed preset load', () => {
    it('does not crash when the hook hands back an Error object', () => {
        mockStudio.mockReturnValue(studio({ error: new Error('boom') }))
        // Rendering an object as a React child throws; before the fix this
        // took the page out entirely.
        expect(() => render(<PromptStudioPage />)).not.toThrow()
    })

    it('shows a readable message rather than a blank or broken page', () => {
        const err = Object.assign(new Error('nope'), { status: 500 })
        mockStudio.mockReturnValue(studio({ error: err }))
        render(<PromptStudioPage />)
        // Whatever copy the mapper picks, the user must get words.
        expect(document.body.textContent.trim().length).toBeGreaterThan(0)
        expect(screen.queryByText('[object Object]')).not.toBeInTheDocument()
    })

    it('survives an error carrying a machine-readable code', () => {
        const err = Object.assign(new Error('quota'), { status: 429, code: 'QUOTA_EXCEEDED' })
        mockStudio.mockReturnValue(studio({ error: err }))
        expect(() => render(<PromptStudioPage />)).not.toThrow()
    })

    it('still tolerates a plain string error', () => {
        // Some call sites set a string; the page must not regress on those.
        mockStudio.mockReturnValue(studio({ error: 'Save the preset first.' }))
        expect(() => render(<PromptStudioPage />)).not.toThrow()
    })

    it('renders normally when there is no error', () => {
        mockStudio.mockReturnValue(studio())
        expect(() => render(<PromptStudioPage />)).not.toThrow()
    })
})
