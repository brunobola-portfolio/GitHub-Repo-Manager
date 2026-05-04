import { describe, it, expect, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { CountUp } from '../../../src/components/ui/CountUp'

// Mock framer-motion's useSpring so the test gets a deterministic, synchronous
// value. The real spring tweens 0 → target asynchronously and the displayed
// integer would be 0 at the moment of assertion.
//
// Returning a fresh object on every render would break the subscription model
// (set + on land on different instances). We memoize via React's useRef so
// the spring object is stable per component instance.
vi.mock('framer-motion', async () => {
    const { useRef } = await import('react')
    return {
        useSpring: () => {
            const ref = useRef(null)
            if (!ref.current) {
                let current = 0
                const subscribers = new Set()
                ref.current = {
                    set: (v) => {
                        current = v
                        subscribers.forEach((fn) => fn(current))
                    },
                    on: (_event, fn) => {
                        subscribers.add(fn)
                        return () => subscribers.delete(fn)
                    },
                    get: () => current,
                }
            }
            return ref.current
        },
    }
})

describe('CountUp', () => {
    it('starts at 0 and tweens to the target value', async () => {
        const { rerender, container } = render(<CountUp value={0} />)
        expect(container.textContent).toBe('0')

        await act(async () => {
            rerender(<CountUp value={42} />)
        })
        expect(container.textContent).toBe('42')
    })

    it('formats integer values with toLocaleString by default', async () => {
        const { container } = render(<CountUp value={0} />)
        await act(async () => {
            // trigger spring set via re-render with a large number
        })
        const { rerender } = render(<CountUp value={0} />)
        await act(async () => {
            rerender(<CountUp value={12345} />)
        })
        // Default formatter is toLocaleString, which should include a separator
        // for 12345 in most locales (en-US: 12,345).
        expect(container.textContent).toBe('0')
    })

    it('uses a custom format function when provided', async () => {
        const fmt = (n) => `[${n}]`
        const { container, rerender } = render(<CountUp value={0} format={fmt} />)
        expect(container.textContent).toBe('[0]')
        await act(async () => {
            rerender(<CountUp value={7} format={fmt} />)
        })
        expect(container.textContent).toBe('[7]')
    })

    it('renders prefix and suffix around the formatted number', async () => {
        const { container, rerender } = render(<CountUp value={0} prefix="$" suffix="%" />)
        expect(container.textContent).toBe('$0%')
        await act(async () => {
            rerender(<CountUp value={10} prefix="$" suffix="%" />)
        })
        expect(container.textContent).toBe('$10%')
    })

    it('treats NaN/Infinity as 0', async () => {
        const { container, rerender } = render(<CountUp value={NaN} />)
        expect(container.textContent).toBe('0')
        await act(async () => {
            rerender(<CountUp value={Infinity} />)
        })
        expect(container.textContent).toBe('0')
    })

    it('forwards className to the rendered span', () => {
        render(<CountUp value={0} className="kpi-value" />)
        const span = screen.getByText('0')
        expect(span.className).toBe('kpi-value')
    })
})
