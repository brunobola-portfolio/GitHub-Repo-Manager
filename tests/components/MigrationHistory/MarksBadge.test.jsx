import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MarksBadge } from '../../../src/components/MigrationHistory/MarksBadge.jsx'

describe('<MarksBadge>', () => {
  it('renders ok variant when all marks written', () => {
    render(<MarksBadge marks={[{ status: 'written' }, { status: 'written' }]} />)
    expect(screen.getByLabelText(/all migration marks written/i)).toBeInTheDocument()
    expect(screen.getByText('2/2')).toBeInTheDocument()
  })

  it('renders partial variant when any mark skipped', () => {
    render(<MarksBadge marks={[{ status: 'written' }, { status: 'skipped' }]} />)
    expect(screen.getByLabelText(/some migration marks skipped/i)).toBeInTheDocument()
    expect(screen.getByText('1/2')).toBeInTheDocument()
  })

  it('renders failed variant when any mark failed (takes precedence over skipped)', () => {
    render(<MarksBadge marks={[{ status: 'written' }, { status: 'failed' }, { status: 'skipped' }]} />)
    expect(screen.getByLabelText(/migration marks failed/i)).toBeInTheDocument()
  })

  it('renders none variant when no marks', () => {
    render(<MarksBadge marks={[]} />)
    expect(screen.getByLabelText(/no migration marks/i)).toBeInTheDocument()
    expect(screen.getByText('No tags')).toBeInTheDocument()
  })

  it('invokes onClick when clicked', () => {
    const onClick = vi.fn()
    render(<MarksBadge marks={[{ status: 'written' }]} onClick={onClick} />)
    fireEvent.click(screen.getByLabelText(/all migration marks written/i))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('defaults marks to empty array', () => {
    render(<MarksBadge />)
    expect(screen.getByLabelText(/no migration marks/i)).toBeInTheDocument()
  })
})
