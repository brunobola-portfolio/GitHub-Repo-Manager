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

  it('applies custom gradient class', () => {
    const { container } = render(
      <EmptyState icon={Inbox} title="Test" gradient="from-red-500 to-pink-600" />
    )
    const gradientDiv = container.querySelector('.from-red-500')
    expect(gradientDiv).toBeInTheDocument()
  })
})
