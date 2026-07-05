import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { Tooltip } from '../../../src/components/ui/Tooltip'

// Helper: pin a trigger's rect so the flip math is deterministic in jsdom
// (which otherwise reports an all-zero getBoundingClientRect).
function mockRect(el, rect) {
  el.getBoundingClientRect = () => ({
    top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0,
    x: 0, y: 0, toJSON: () => {}, ...rect,
  })
}

describe('Tooltip', () => {
  it('appears after 300ms hover', () => {
    vi.useFakeTimers()
    render(<Tooltip label="Sync repos"><button>Sync</button></Tooltip>)
    fireEvent.mouseEnter(screen.getByText('Sync'))
    expect(screen.queryByText('Sync repos')).not.toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(300) })
    expect(screen.getByText('Sync repos')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('hides immediately on mouseleave', () => {
    vi.useFakeTimers()
    render(<Tooltip label="Sync repos"><button>Sync</button></Tooltip>)
    fireEvent.mouseEnter(screen.getByText('Sync'))
    act(() => { vi.advanceTimersByTime(300) })
    fireEvent.mouseLeave(screen.getByText('Sync'))
    expect(screen.queryByText('Sync repos')).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it('renders the label through a portal on <body> (not clipped inside the trigger wrapper)', () => {
    vi.useFakeTimers()
    const { container } = render(<Tooltip label="Sync repos"><button>Sync</button></Tooltip>)
    fireEvent.mouseEnter(screen.getByText('Sync'))
    act(() => { vi.advanceTimersByTime(300) })
    const tip = screen.getByRole('tooltip')
    // It's position:fixed and lives outside the component's own subtree.
    expect(tip).toHaveStyle({ position: 'fixed' })
    expect(container.contains(tip)).toBe(false)
    vi.useRealTimers()
  })

  it('flips below the trigger when there is no room above (viewport top)', () => {
    vi.useFakeTimers()
    render(<Tooltip label="Sync repos"><button>Sync</button></Tooltip>)
    const btn = screen.getByText('Sync')
    mockRect(btn, { top: 2, bottom: 26, left: 100, width: 40, height: 24 })
    fireEvent.mouseEnter(btn)
    act(() => { vi.advanceTimersByTime(300) })
    // Arrow sits at the TOP of the bubble pointing up → bubble is below.
    const arrow = screen.getByRole('tooltip').querySelector('span[aria-hidden="true"]')
    expect(arrow.className).toContain('bottom-full')
    vi.useRealTimers()
  })

  it('stays above the trigger when there is room (mid-viewport)', () => {
    vi.useFakeTimers()
    render(<Tooltip label="Sync repos"><button>Sync</button></Tooltip>)
    const btn = screen.getByText('Sync')
    mockRect(btn, { top: 400, bottom: 424, left: 100, width: 40, height: 24 })
    fireEvent.mouseEnter(btn)
    act(() => { vi.advanceTimersByTime(300) })
    const arrow = screen.getByRole('tooltip').querySelector('span[aria-hidden="true"]')
    expect(arrow.className).toContain('top-full')
    vi.useRealTimers()
  })

  it('reveals immediately on touch and auto-hides so it cannot stick', () => {
    vi.useFakeTimers()
    render(<Tooltip label="Sync repos"><button>Sync</button></Tooltip>)
    fireEvent.touchStart(screen.getByText('Sync'))
    // No 300ms wait on touch.
    expect(screen.getByText('Sync repos')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(1600) })
    expect(screen.queryByText('Sync repos')).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it('mirrors a string label into aria-label for icon-only buttons', () => {
    render(<Tooltip label="Dismiss"><button aria-hidden={false}><svg /></button></Tooltip>)
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Dismiss')
  })

  it('never overrides an explicit aria-label on the child', () => {
    render(<Tooltip label="Tooltip text"><button aria-label="Real name"><svg /></button></Tooltip>)
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Real name')
  })

  it('dismisses a visible tooltip on Escape without moving focus (WCAG 1.4.13)', () => {
    vi.useFakeTimers()
    render(<Tooltip label="Sync repos"><button>Sync</button></Tooltip>)
    const btn = screen.getByText('Sync')
    btn.focus()
    fireEvent.mouseEnter(btn)
    act(() => { vi.advanceTimersByTime(300) })
    expect(screen.getByText('Sync repos')).toBeInTheDocument()
    expect(document.activeElement).toBe(btn)
    // Escape hides the tooltip; focus stays put and it doesn't re-reveal.
    act(() => { fireEvent.keyDown(btn, { key: 'Escape' }) })
    expect(screen.queryByText('Sync repos')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(btn)
    act(() => { vi.advanceTimersByTime(300) })
    expect(screen.queryByText('Sync repos')).not.toBeInTheDocument()
    vi.useRealTimers()
  })
})
