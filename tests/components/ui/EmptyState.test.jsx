import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EmptyState } from '@/components/ui/EmptyState'
import { Inbox } from 'lucide-react'

describe('EmptyState', () => {
  it('renders title and description', () => {
    render(
      <EmptyState
        icon={Inbox}
        title="No repos found"
        description="Try a different search."
      />
    )
    expect(screen.getByText('No repos found')).toBeInTheDocument()
    expect(screen.getByText('Try a different search.')).toBeInTheDocument()
  })

  it('renders icon', () => {
    const { container } = render(
      <EmptyState icon={Inbox} title="Test" />
    )
    // Lucide renders an SVG
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('renders action button with legacy props', () => {
    const onClick = vi.fn()
    render(
      <EmptyState
        icon={Inbox}
        title="Empty"
        actionLabel="Add Item"
        onAction={onClick}
      />
    )
    const btn = screen.getByText('Add Item')
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('renders action button with new action prop', () => {
    const onClick = vi.fn()
    render(
      <EmptyState
        icon={Inbox}
        title="Empty"
        action={{ label: 'Create', onClick }}
      />
    )
    const btn = screen.getByText('Create')
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not render action button when no action provided', () => {
    render(
      <EmptyState icon={Inbox} title="Empty" description="Nothing here" />
    )
    // No buttons should be present
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('gradient prop is deprecated — icon area uses neutral bg regardless', () => {
    const { container } = render(
      <EmptyState icon={Inbox} title="Test" gradient="from-red-500 to-brand-600" />
    )
    // gradient prop is now ignored; icon container uses slate bg
    expect(container.querySelector('.from-red-500')).toBeNull()
    expect(container.querySelector('[class*="bg-slate"]')).toBeInTheDocument()
  })

  it('exposes data-testid="empty-state" for e2e selectors', () => {
    render(<EmptyState icon={Inbox} title="Nothing yet" description="Try again." />)
    expect(screen.getByTestId('empty-state')).toBeInTheDocument()
  })
})
