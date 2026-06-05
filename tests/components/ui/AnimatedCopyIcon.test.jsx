import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { AnimatedCopyIcon } from '@/components/ui/AnimatedCopyIcon'

// The icon is decorative (aria-hidden); assert via lucide's per-icon class so
// we verify the right glyph renders for each state.
describe('AnimatedCopyIcon', () => {
  it('renders the copy glyph when not copied', () => {
    const { container } = render(<AnimatedCopyIcon copied={false} />)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    expect(svg.getAttribute('class')).toMatch(/copy/i)
    expect(container.querySelector('svg')?.getAttribute('class')).not.toMatch(/check/i)
  })

  it('renders the check glyph when copied', () => {
    const { container } = render(<AnimatedCopyIcon copied={true} />)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    expect(svg.getAttribute('class')).toMatch(/check/i)
  })

  it('applies the tone class for the active state', () => {
    const { container } = render(
      <AnimatedCopyIcon copied={true} checkClassName="text-emerald-500" />,
    )
    expect(container.querySelector('svg')?.getAttribute('class')).toMatch(/text-emerald-500/)
  })
})
