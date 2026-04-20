import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { CodeownersSuggestModal } from '@/components/CodeownersSuggestModal'

// Modal uses focus-trap + body scroll lock; stub to keep tests fast and
// avoid DOM polyfill edge cases.
vi.mock('@/hooks/useFocusTrap', () => ({ useFocusTrap: () => ({ current: null }) }))
vi.mock('@/hooks/useBodyScrollLock', () => ({ useBodyScrollLock: () => {} }))
vi.mock('@/hooks/useMobileKeyboardFix', () => ({ useMobileKeyboardFix: () => {} }))

// Framer Motion passthrough so animations don't delay assertions.
vi.mock('framer-motion', () => {
    const React = require('react')
    function passthrough({ children, ...rest }) {
        const { initial, animate, exit, variants, transition, layout, whileHover, whileTap, ...clean } = rest
        return React.createElement('div', clean, children)
    }
    const motion = new Proxy({}, { get: () => passthrough })
    return { motion, AnimatePresence: ({ children }) => children, useReducedMotion: () => false }
})

const mockSuggest = vi.fn()
vi.mock('@/api/repos', () => ({
    reposApi: {
        suggestCodeowners: (...a) => mockSuggest(...a),
    },
}))

function renderModal(props = {}) {
    return render(
        <CodeownersSuggestModal
            isOpen={true}
            onClose={vi.fn()}
            owner="acme"
            repo="app"
            {...props}
        />
    )
}

const writeTextMock = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
    mockSuggest.mockReset()
    writeTextMock.mockClear()
    // happy-dom may expose navigator.clipboard as a non-configurable getter,
    // so use vi.stubGlobal which creates a fresh navigator-shaped object
    // scoped to this test only.
    vi.stubGlobal('navigator', {
        ...globalThis.navigator,
        clipboard: { writeText: writeTextMock },
    })
})

afterEach(() => {
    vi.useRealTimers()
})

describe('CodeownersSuggestModal', () => {
    it('fetches suggestions on open and renders rules + hotspots', async () => {
        mockSuggest.mockResolvedValueOnce({
            found: true,
            analyzedCommits: 50,
            rules: [
                { pattern: 'src/', owners: ['@alice', '@bob'] },
                { pattern: 'docs/', owners: ['@carol'] },
            ],
            preview: 'src/        @alice @bob\ndocs/       @carol\n',
        })

        await act(async () => { renderModal() })

        await waitFor(() => {
            expect(screen.getByText(/50 commits analysed/i)).toBeInTheDocument()
        })
        // Patterns appear in both the Hotspots pill row and the rules table,
        // so use getAllByText rather than getByText which throws on dupes.
        expect(screen.getAllByText('src/').length).toBeGreaterThanOrEqual(1)
        expect(screen.getAllByText('docs/').length).toBeGreaterThanOrEqual(1)
        expect(screen.getByText('@alice')).toBeInTheDocument()
        expect(screen.getByText('@carol')).toBeInTheDocument()
        // Preview textarea holds the full CODEOWNERS body
        const textarea = screen.getByRole('textbox')
        expect(textarea).toHaveValue('src/        @alice @bob\ndocs/       @carol\n')
    })

    it('shows an empty hint when the endpoint returns found=false', async () => {
        mockSuggest.mockResolvedValueOnce({
            found: false,
            analyzedCommits: 12,
            rules: [],
            preview: '',
        })

        await act(async () => { renderModal() })

        await waitFor(() => {
            expect(screen.getByText(/No suggestions yet/i)).toBeInTheDocument()
            expect(screen.getByText(/12 commits/)).toBeInTheDocument()
        })
    })

    it('surfaces fetch errors as a visible banner', async () => {
        mockSuggest.mockRejectedValueOnce(new Error('rate limit reached'))
        await act(async () => { renderModal() })
        await waitFor(() => {
            expect(screen.getByText(/rate limit reached/i)).toBeInTheDocument()
        })
    })

    it('copies the preview to the clipboard when the Copy button is clicked', async () => {
        mockSuggest.mockResolvedValueOnce({
            found: true,
            analyzedCommits: 30,
            rules: [{ pattern: 'src/', owners: ['@alice'] }],
            preview: 'src/ @alice\n',
        })
        await act(async () => { renderModal() })
        await waitFor(() => expect(screen.getAllByText('src/').length).toBeGreaterThan(0))

        const copyBtn = screen.getByTestId('codeowners-copy-btn')
        await act(async () => {
            fireEvent.click(copyBtn)
            // Flush the awaited clipboard.writeText + setCopied so React
            // commits the "Copied" state before we assert.
            await Promise.resolve()
            await Promise.resolve()
        })

        expect(writeTextMock).toHaveBeenCalledWith('src/ @alice\n')
    })

    it('regenerates with new tunables when the user clicks Regenerate', async () => {
        mockSuggest.mockResolvedValue({
            found: true,
            analyzedCommits: 100,
            rules: [{ pattern: 'src/', owners: ['@alice'] }],
            preview: 'src/ @alice\n',
        })
        await act(async () => { renderModal() })
        await waitFor(() => expect(mockSuggest).toHaveBeenCalledTimes(1))

        // First call is the initial open with defaults.
        expect(mockSuggest).toHaveBeenCalledWith('acme', 'app', {
            commits: 100, minTouches: 2, maxOwners: 3,
        })

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /regenerate/i }))
        })
        expect(mockSuggest).toHaveBeenCalledTimes(2)
    })
})
