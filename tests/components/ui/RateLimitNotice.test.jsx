import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { RateLimitNotice } from '@/components/ui/RateLimitNotice'

// Mock framer-motion to skip animations in tests.
// NOTE: We cache the factory per-tag so React sees a stable component type
// across renders (Proxy.get otherwise returns a NEW function every access,
// which causes React to treat the node as a different type and remount the
// subtree — destroying captured DOM references mid-test).
const motionFactoryCache = new Map()
const makeMotionComponent = (tag) => {
    if (!motionFactoryCache.has(tag)) {
        const Component = ({ children, ...props }) => {
            const filtered = { ...props }
            delete filtered.initial
            delete filtered.animate
            delete filtered.exit
            delete filtered.transition
            delete filtered.whileHover
            delete filtered.whileTap
            return <div {...filtered}>{children}</div>
        }
        motionFactoryCache.set(tag, Component)
    }
    return motionFactoryCache.get(tag)
}
vi.mock('framer-motion', () => ({
    motion: new Proxy({}, {
        get: (_target, prop) => makeMotionComponent(prop),
    }),
    AnimatePresence: ({ children }) => <>{children}</>,
}))

describe('RateLimitNotice', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-04-09T10:00:00Z'))
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it('renders toast variant with a visible seconds-left count', () => {
        const retryAt = Date.now() + 30_000
        render(<RateLimitNotice variant="toast" retryAt={retryAt} />)
        // "30" should appear inside the countdown element
        expect(screen.getByText('30')).toBeInTheDocument()
        // The friendly message prefix
        expect(screen.getByText(/take a quick breath/i)).toBeInTheDocument()
    })

    it('renders banner variant with the Retry now button disabled until ready', () => {
        const retryAt = Date.now() + 10_000
        render(<RateLimitNotice variant="banner" retryAt={retryAt} />)
        const button = screen.getByRole('button', { name: /retry now/i })
        expect(button).toBeDisabled()
    })

    it('enables the retry button when countdown reaches zero and calls onRetry', async () => {
        const retryAt = Date.now() + 2_000
        const onRetry = vi.fn()
        render(<RateLimitNotice variant="banner" retryAt={retryAt} onRetry={onRetry} />)
        const button = screen.getByRole('button', { name: /retry now/i })
        expect(button).toBeDisabled()
        // Let the countdown expire. Wrap in act so React flushes the
        // setInterval-driven state updates from useCountdown.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(2100)
        })
        expect(button).toBeEnabled()
        // Use fireEvent rather than userEvent because userEvent's
        // advanceTimers integration deadlocks against our fake clock here.
        fireEvent.click(button)
        expect(onRetry).toHaveBeenCalledTimes(1)
    })

    it('shows the "ready" copy when isReady', () => {
        const retryAt = Date.now() - 1_000 // already ready
        render(<RateLimitNotice variant="toast" retryAt={retryAt} />)
        expect(screen.getByText(/you're good to go/i)).toBeInTheDocument()
    })
})
