import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Badge } from '../../../src/components/ui/Badge'

describe('Badge — backward compatibility (legacy variant prop)', () => {
  it('renders children', () => {
    render(<Badge data-testid="b">Hello</Badge>)
    expect(screen.getByTestId('b')).toHaveTextContent('Hello')
  })

  it('defaults to the slate "default" palette at the sm scale (historical look)', () => {
    render(<Badge data-testid="b">x</Badge>)
    const cls = screen.getByTestId('b').className
    // palette
    expect(cls).toContain('bg-slate-100')
    expect(cls).toContain('text-slate-800')
    // sm scale === the original px-2.5 py-0.5 text-xs
    expect(cls).toContain('px-2.5')
    expect(cls).toContain('py-0.5')
    expect(cls).toContain('text-xs')
    expect(cls).toContain('rounded-full')
    expect(cls).toContain('font-medium')
  })

  it.each([
    ['default', 'bg-slate-100'],
    ['secondary', 'bg-slate-200'],
    ['success', 'bg-emerald-100'],
    ['warning', 'bg-amber-100'],
    ['danger', 'bg-rose-100'], // danger merged onto rose (red retired, 2026-09-04 panel FE-05)
    ['info', 'bg-brand-100'],
  ])('legacy variant "%s" keeps its palette', (variant, expectedBg) => {
    render(<Badge data-testid="b" variant={variant}>x</Badge>)
    expect(screen.getByTestId('b').className).toContain(expectedBg)
  })
})

describe('Badge — tone prop', () => {
  it.each([
    ['neutral', 'bg-slate-100'],
    ['brand', 'bg-brand-100'],
    ['success', 'bg-emerald-100'],
    ['warning', 'bg-amber-100'],
    ['danger', 'bg-rose-100'], // danger merged onto rose (red retired, 2026-09-04 panel FE-05)
    ['rose', 'bg-rose-100'],
    ['info', 'bg-brand-100'],
    ['blue', 'bg-blue-100'],
    ['violet', 'bg-brand-100'],
  ])('tone "%s" maps to its palette', (tone, expectedBg) => {
    render(<Badge data-testid="b" tone={tone}>x</Badge>)
    expect(screen.getByTestId('b').className).toContain(expectedBg)
  })

  it.each([
    ['slate', 'bg-slate-100'],
    ['indigo', 'bg-brand-100'],
    ['emerald', 'bg-emerald-100'],
    ['amber', 'bg-amber-100'],
    ['red', 'bg-rose-100'], // "red" alias still resolves to "danger", which is rose now (red retired, FE-05)
    ['sky', 'bg-brand-100'],
    ['purple', 'bg-brand-100'],
  ])('alias "%s" resolves to the canonical tone', (alias, expectedBg) => {
    render(<Badge data-testid="b" tone={alias}>x</Badge>)
    expect(screen.getByTestId('b').className).toContain(expectedBg)
  })

  it('tone wins over variant when both are given', () => {
    render(<Badge data-testid="b" variant="danger" tone="success">x</Badge>)
    const cls = screen.getByTestId('b').className
    expect(cls).toContain('bg-emerald-100')
    expect(cls).not.toContain('bg-rose-100') // danger's palette is rose now, not red (FE-05)
  })

  it('every tone ships a dark: pair for AA contrast', () => {
    for (const tone of ['neutral', 'brand', 'success', 'warning', 'danger', 'rose', 'info', 'blue', 'violet']) {
      const { container } = render(<Badge tone={tone}>x</Badge>)
      const cls = container.firstChild.className
      expect(cls).toMatch(/dark:bg-/)
      expect(cls).toMatch(/dark:text-/)
    }
  })
})

describe('Badge — size prop', () => {
  it('sm (default) uses the px-2.5 text-xs scale', () => {
    render(<Badge data-testid="b" size="sm">x</Badge>)
    const cls = screen.getByTestId('b').className
    expect(cls).toContain('px-2.5')
    expect(cls).toContain('text-xs')
  })

  it('xs uses the compact px-1.5 ds-text-micro scale', () => {
    // ds-text-micro (10px/14px) replaced the arbitrary text-[10px] value —
    // same size, now a named token (2026-09-04 panel, F18).
    render(<Badge data-testid="b" size="xs">x</Badge>)
    const cls = screen.getByTestId('b').className
    expect(cls).toContain('px-1.5')
    expect(cls).toContain('ds-text-micro')
    expect(cls).not.toContain('px-2.5')
  })
})

describe('Badge — ring / icon / dot', () => {
  it('adds a tone-matched inset ring only when ring is set', () => {
    render(<Badge data-testid="plain" tone="brand">x</Badge>)
    expect(screen.getByTestId('plain').className).not.toContain('ring-1')

    render(<Badge data-testid="ringed" tone="brand" ring>x</Badge>)
    const cls = screen.getByTestId('ringed').className
    expect(cls).toContain('ring-1')
    expect(cls).toContain('ring-inset')
    expect(cls).toContain('ring-brand-200')
  })

  it('renders a leading icon node and adds a gap', () => {
    render(<Badge data-testid="b" icon={<svg data-testid="ico" />}>x</Badge>)
    expect(screen.getByTestId('ico')).toBeInTheDocument()
    expect(screen.getByTestId('b').className).toContain('gap-1')
  })

  it('renders a status dot when dot is true (bg-current)', () => {
    const { container } = render(<Badge dot>x</Badge>)
    const dot = container.querySelector('span[aria-hidden="true"]')
    expect(dot).not.toBeNull()
    expect(dot.className).toContain('rounded-full')
    expect(dot.className).toContain('bg-current')
    expect(container.firstChild.className).toContain('gap-1')
  })

  it('accepts a custom dot colour class', () => {
    const { container } = render(<Badge dot="bg-emerald-500">x</Badge>)
    const dot = container.querySelector('span[aria-hidden="true"]')
    expect(dot.className).toContain('bg-emerald-500')
  })

  it('renders no dot by default', () => {
    const { container } = render(<Badge>x</Badge>)
    expect(container.querySelector('span[aria-hidden="true"]')).toBeNull()
  })
})

describe('Badge — polymorphism + passthrough', () => {
  it('honours the as prop', () => {
    render(<Badge as="div" data-testid="b">x</Badge>)
    expect(screen.getByTestId('b').tagName).toBe('DIV')
  })

  it('forwards arbitrary attributes (role, aria, data-*)', () => {
    render(<Badge data-testid="b" role="status" aria-live="polite">x</Badge>)
    const el = screen.getByTestId('b')
    expect(el).toHaveAttribute('role', 'status')
    expect(el).toHaveAttribute('aria-live', 'polite')
  })

  it('lets className override base utilities via tailwind-merge', () => {
    render(<Badge data-testid="b" className="py-0 font-normal">x</Badge>)
    const cls = screen.getByTestId('b').className
    expect(cls).toContain('py-0')
    expect(cls).not.toContain('py-0.5')
    expect(cls).toContain('font-normal')
    expect(cls).not.toContain('font-medium')
  })
})
