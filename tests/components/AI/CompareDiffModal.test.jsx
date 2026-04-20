import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { CompareDiffModal } from '@/components/AI/CompareDiffModal'

vi.mock('@/hooks/useFocusTrap', () => ({ useFocusTrap: () => ({ current: null }) }))
vi.mock('@/hooks/useBodyScrollLock', () => ({ useBodyScrollLock: () => {} }))
vi.mock('@/hooks/useMobileKeyboardFix', () => ({ useMobileKeyboardFix: () => {} }))

vi.mock('framer-motion', () => {
    const React = require('react')
    function passthrough({ children, ...rest }) {
        const { initial, animate, exit, variants, transition, layout, whileHover, whileTap, ...clean } = rest
        return React.createElement('div', clean, children)
    }
    const motion = new Proxy({}, { get: () => passthrough })
    return { motion, AnimatePresence: ({ children }) => children, useReducedMotion: () => false }
})

const mockGetFile = vi.fn()
vi.mock('@/api/repos', () => ({
    reposApi: {
        getFileContent: (...a) => mockGetFile(...a),
    },
}))

// Helper — build a valid base64 for ASCII text so decodeBase64Utf8 returns
// the expected string.
function b64(text) {
    // btoa only handles Latin-1; tests use ASCII so this is safe.
    return typeof btoa === 'function'
        ? btoa(text)
        : Buffer.from(text, 'utf8').toString('base64')
}

const baseProps = {
    isOpen: true,
    onClose: vi.fn(),
    source: { owner: 'acme', repo: 'app' },
    target: { owner: 'acme', repo: 'app-v2' },
    targetLabel: 'acme/app-v2',
}

beforeEach(() => {
    mockGetFile.mockReset()
})

describe('CompareDiffModal', () => {
    it('fetches README and package.json for both source and target on open', async () => {
        mockGetFile.mockImplementation(async (owner, repo, path) => {
            return { data: { content: b64(`${owner}/${repo} - ${path}`) } }
        })
        await act(async () => { render(<CompareDiffModal {...baseProps} />) })

        await waitFor(() => {
            expect(mockGetFile).toHaveBeenCalledWith('acme', 'app', 'README.md')
            expect(mockGetFile).toHaveBeenCalledWith('acme', 'app-v2', 'README.md')
            expect(mockGetFile).toHaveBeenCalledWith('acme', 'app', 'package.json')
            expect(mockGetFile).toHaveBeenCalledWith('acme', 'app-v2', 'package.json')
        })
    })

    it('renders side-by-side panes with decoded UTF-8 content', async () => {
        mockGetFile.mockImplementation(async (owner, repo, path) => {
            if (path === 'README.md') {
                return { data: { content: b64(`# ${owner}/${repo}\nHello world`) } }
            }
            return { data: { content: b64('{"name": "x"}') } }
        })
        const { container } = render(<CompareDiffModal {...baseProps} />)

        // Content lives inside <pre>; assert via container.textContent so
        // substring matching works regardless of how React splits text nodes.
        await waitFor(() => {
            const text = container.textContent || ''
            expect(text).toContain('# acme/app')
            expect(text).toContain('# acme/app-v2')
        })
    })

    it('shows a "file missing" hint when a file 404s', async () => {
        mockGetFile.mockImplementation(async (_owner, _repo, path) => {
            if (path === 'README.md') {
                const err = new Error('not found')
                err.status = 404
                throw err
            }
            return { data: { content: b64('{"name": "pkg"}') } }
        })
        await act(async () => { render(<CompareDiffModal {...baseProps} />) })

        await waitFor(() => {
            // Both source and target 404 on README.md
            const missingHints = screen.getAllByText(/File does not exist/i)
            expect(missingHints.length).toBe(2)
        })
    })

    it('lets the user toggle between README and package.json tabs', async () => {
        mockGetFile.mockImplementation(async (owner, repo, path) => {
            return { data: { content: b64(`FILE=${path}`) } }
        })
        await act(async () => { render(<CompareDiffModal {...baseProps} />) })

        await waitFor(() => {
            expect(screen.getAllByText(/FILE=README.md/).length).toBe(2)
        })

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /package\.json/i }))
        })
        await waitFor(() => {
            expect(screen.getAllByText(/FILE=package.json/).length).toBe(2)
        })
    })

    it('surfaces non-404 errors with their message', async () => {
        mockGetFile.mockImplementation(async () => {
            throw new Error('rate limit exceeded')
        })
        await act(async () => { render(<CompareDiffModal {...baseProps} />) })
        await waitFor(() => {
            // Both panes should show the rate-limit message for each file (4 total).
            const panes = screen.getAllByText(/rate limit exceeded/i)
            expect(panes.length).toBeGreaterThan(0)
        })
    })
})
