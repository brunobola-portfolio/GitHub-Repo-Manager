import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Kbd } from '../../../src/components/ui/Kbd'

describe('Kbd', () => {
  it('renders provided key text', () => {
    render(<Kbd>⌘K</Kbd>)
    expect(screen.getByText('⌘K')).toBeInTheDocument()
  })

  it('applies platform-aware mod key when modifier="mod"', () => {
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true })
    render(<Kbd modifier="mod">K</Kbd>)
    expect(screen.getByText('⌘K')).toBeInTheDocument()
  })

  it('uses Ctrl prefix on non-mac when modifier="mod"', () => {
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true })
    render(<Kbd modifier="mod">K</Kbd>)
    expect(screen.getByText('Ctrl+K')).toBeInTheDocument()
  })

  it('default tone uses the muted slate pill (neutral surfaces)', () => {
    const { container } = render(<Kbd>Esc</Kbd>)
    const cls = container.querySelector('kbd').className
    expect(cls).toContain('--ds-surface-muted')
    expect(cls).not.toContain('bg-white/20')
  })

  it('onSolid tone keeps its glyph at full white on a coloured button', () => {
    // The tint stays translucent — it is a surface, and 3:1 is the bar for a
    // non-text boundary. The GLYPH does not: text-white/90 measures 4.43:1 on
    // the brand fill, which is the axe failure this tone used to ship.
    const { container } = render(<Kbd tone="onSolid">↵</Kbd>)
    const cls = container.querySelector('kbd').className
    expect(cls).toContain('text-white')
    expect(cls).not.toMatch(/text-white\/\d/)
    expect(cls).toContain('bg-white/20')
    expect(cls).toContain('border-white/30')
    expect(cls).not.toContain('--ds-surface-muted')
  })
})
