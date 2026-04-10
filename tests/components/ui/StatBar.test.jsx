import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatBar } from '@/components/ui/StatBar'

describe('StatBar', () => {
  it('renders label and value/max', () => {
    render(<StatBar label="Documentation" value={18} max={30} />)
    expect(screen.getByText('Documentation')).toBeInTheDocument()
    expect(screen.getByText('18/30')).toBeInTheDocument()
  })

  it('hides value when showValue=false', () => {
    render(<StatBar label="Docs" value={18} max={30} showValue={false} />)
    expect(screen.queryByText('18/30')).not.toBeInTheDocument()
  })

  it('exposes percentage via aria attributes', () => {
    render(<StatBar label="Docs" value={15} max={30} />)
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('15')
    expect(bar.getAttribute('aria-valuemax')).toBe('30')
    expect(bar.getAttribute('aria-valuemin')).toBe('0')
    expect(bar.getAttribute('aria-label')).toBe('Docs')
  })

  it('clamps value above max to max', () => {
    render(<StatBar label="Over" value={50} max={30} />)
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('30')
  })

  it('clamps negative value to 0', () => {
    render(<StatBar label="Neg" value={-5} max={30} />)
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('0')
  })

  it('handles max of 0 without dividing by zero', () => {
    render(<StatBar label="Zero" value={0} max={0} />)
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('renders with animated=false using inline width', () => {
    render(<StatBar label="Live" value={42} max={100} animated={false} />)
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    const fill = screen.getByTestId('statbar-fill')
    expect(fill.style.width).toBe('42%')
  })

  it('animated=false with clamped value renders correct width', () => {
    render(<StatBar label="Live" value={150} max={100} animated={false} />)
    const fill = screen.getByTestId('statbar-fill')
    expect(fill.style.width).toBe('100%')
  })

  it('size sm applies h-1.5 class', () => {
    render(<StatBar label="S" value={5} max={10} size="sm" />)
    expect(screen.getByRole('progressbar').className).toMatch(/h-1\.5/)
  })

  it('size md applies h-2 class (default)', () => {
    render(<StatBar label="M" value={5} max={10} />)
    expect(screen.getByRole('progressbar').className).toMatch(/h-2/)
  })

  it('applies gradient class for primary (default)', () => {
    render(<StatBar label="G" value={5} max={10} animated={false} />)
    const fill = screen.getByTestId('statbar-fill')
    expect(fill.className).toMatch(/from-indigo-500/)
  })

  it('applies gradient class for secondary', () => {
    render(<StatBar label="G" value={5} max={10} gradient="secondary" animated={false} />)
    const fill = screen.getByTestId('statbar-fill')
    expect(fill.className).toMatch(/from-cyan-500/)
  })
})
