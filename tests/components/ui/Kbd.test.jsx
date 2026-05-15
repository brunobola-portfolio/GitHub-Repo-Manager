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
})
