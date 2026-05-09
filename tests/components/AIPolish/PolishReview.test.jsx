/*
 * Tests for <PolishReview /> — Task 13 integration:
 *   - ContextPicker renders in batch mode
 *   - per-row confidence dot renders with correct aria-label
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// ── mock framer-motion so AnimatePresence + motion.div render children directly ──
vi.mock('framer-motion', () => ({
    AnimatePresence: ({ children }) => children,
    motion: new Proxy(
        {},
        {
            get: (_target, _tag) =>
                ({ children, ...rest }) => {
                    const { initial: _i, animate: _a, exit: _e, transition: _t, ...domProps } = rest
                    return <div {...domProps}>{children}</div>
                },
        },
    ),
}))

// ── mock useAIPolish so we control row state without fetching ──
vi.mock('../../../src/hooks/useAIPolish', () => ({
    useAIPolish: () => ({
        rows: [
            {
                fullName: 'me/repo',
                status: 'ready',
                proposedDescription: 'A tool.',
                currentDescription: '',
                include: true,
                edited: false,
                confidence: 'high',
                error: null,
            },
        ],
        phase: 'idle',
        stats: { total: 1, includedReady: 1, error: 0, done: 0, loading: 0, applying: 0, quota: 0, ready: 1 },
        quotaHit: false,
        setProposedDescription: vi.fn(),
        toggleInclude: vi.fn(),
        retryRow: vi.fn(),
        apply: vi.fn(),
    }),
}))

// ── mock useContextPrefs ──
vi.mock('../../../src/hooks/useContextPrefs', () => ({
    useContextPrefs: () => ({
        prefs: {
            signals: { readme: true, manifest: true, entrypoints: false, folderStructure: false, topics: true, language: true },
        },
        setSignal: vi.fn(),
        reset: vi.fn(),
    }),
}))

// ── import component after mocks ──
import { PolishReview } from '../../../src/components/AIPolish/PolishReview'

describe('<PolishReview />', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('renders the ContextPicker panel (collapsed button with "Context" text)', () => {
        render(<PolishReview repoFullNames={['me/repo']} />)
        // ContextPicker renders a button that includes the word "Context"
        expect(screen.getByText(/context/i)).toBeInTheDocument()
    })

    it('renders the confidence dot with aria-label="Confidence high" for a high-confidence row', () => {
        render(<PolishReview repoFullNames={['me/repo']} />)
        expect(screen.getByLabelText(/confidence high/i)).toBeInTheDocument()
    })

    it('renders the description input pre-populated with the proposed description', () => {
        render(<PolishReview repoFullNames={['me/repo']} />)
        const input = screen.getByDisplayValue('A tool.')
        expect(input).toBeInTheDocument()
    })
})
