import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SidePanel } from '../../../src/components/ui/SidePanel'

describe('SidePanel', () => {
  it('renders title and children when open', () => {
    render(
      <SidePanel isOpen={true} onClose={() => {}} title="Similar Repos">
        <p>content</p>
      </SidePanel>
    )
    expect(screen.getByText('Similar Repos')).toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('renders nothing when closed', () => {
    render(
      <SidePanel isOpen={false} onClose={() => {}} title="Hidden">
        <p>content</p>
      </SidePanel>
    )
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument()
  })

  it('calls onClose when backdrop clicked', () => {
    const onClose = vi.fn()
    render(
      <SidePanel isOpen={true} onClose={onClose} title="X">
        <p>content</p>
      </SidePanel>
    )
    fireEvent.click(screen.getByTestId('sidepanel-backdrop'))
    expect(onClose).toHaveBeenCalled()
  })
})
