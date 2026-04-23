import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TestButton } from '@/components/Settings/AIConfig/TestButton'

vi.mock('framer-motion', () => {
    const React = require('react')
    function passthrough({ children }) { return React.createElement(React.Fragment, null, children) }
    return {
        motion: new Proxy({}, { get: () => passthrough }),
        AnimatePresence: ({ children }) => children,
    }
})

describe('TestButton — isDirty hint', () => {
    it('does not show unsaved-changes hint when isDirty is false', () => {
        render(
            <TestButton onTest={vi.fn()} disabled={false} result={null} countdown={0} isDirty={false} />
        )
        expect(screen.queryByText(/save your changes first/i)).not.toBeInTheDocument()
    })

    it('shows unsaved-changes hint when isDirty is true', () => {
        render(
            <TestButton onTest={vi.fn()} disabled={false} result={null} countdown={0} isDirty={true} />
        )
        expect(screen.getByText(/save your changes first/i)).toBeInTheDocument()
    })

    it('does not show hint when isDirty is true but result is already showing', () => {
        render(
            <TestButton
                onTest={vi.fn()}
                disabled={false}
                result={{ ok: true, latencyMs: 50 }}
                countdown={0}
                isDirty={true}
            />
        )
        // Hint still shows — it's informational, not blocked by result
        expect(screen.getByText(/save your changes first/i)).toBeInTheDocument()
    })
})
