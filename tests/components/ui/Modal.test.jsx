import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Modal } from '@/components/ui/Modal'

vi.mock('@/hooks/useFocusTrap', () => ({
  useFocusTrap: () => ({ current: null })
}))

describe('Modal — base', () => {
  afterEach(() => { cleanup(); document.body.style.overflow = '' })

  it('does not render when closed', () => {
    render(<Modal isOpen={false} onClose={() => {}} title="Hi">body</Modal>)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders title and body when open', () => {
    render(<Modal isOpen={true} onClose={() => {}} title="My title">body</Modal>)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('My title')).toBeInTheDocument()
    expect(screen.getByText('body')).toBeInTheDocument()
  })

  it('renders subtitle below title', () => {
    render(
      <Modal isOpen={true} onClose={() => {}} title="Hi" subtitle="owner/repo">x</Modal>
    )
    expect(screen.getByText('owner/repo')).toBeInTheDocument()
  })

  it('applies size="2xl" max-width class', () => {
    const { container } = render(
      <Modal isOpen={true} onClose={() => {}} title="Hi" size="2xl">x</Modal>
    )
    expect(container.querySelector('[role="dialog"]').className).toMatch(/max-w-5xl/)
  })

  it('applies size="3xl" max-width class', () => {
    const { container } = render(
      <Modal isOpen={true} onClose={() => {}} title="Hi" size="3xl">x</Modal>
    )
    expect(container.querySelector('[role="dialog"]').className).toMatch(/max-w-6xl/)
  })

  it('locks body scroll when open', () => {
    render(<Modal isOpen={true} onClose={() => {}} title="Hi">x</Modal>)
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('restores body scroll when closed', () => {
    const { rerender } = render(<Modal isOpen={true} onClose={() => {}} title="Hi">x</Modal>)
    expect(document.body.style.overflow).toBe('hidden')
    rerender(<Modal isOpen={false} onClose={() => {}} title="Hi">x</Modal>)
    expect(document.body.style.overflow).toBe('')
  })
})

import { fireEvent } from '@testing-library/react'
import { Sparkles, FileText } from 'lucide-react'

describe('Modal — tabs', () => {
  afterEach(() => { cleanup(); document.body.style.overflow = '' })

  const tabs = [
    { id: 'overview', label: 'Overview', icon: Sparkles },
    { id: 'readme',   label: 'README',   icon: FileText },
  ]

  it('renders tabs when tabs prop is provided', () => {
    render(
      <Modal
        isOpen={true} onClose={() => {}} title="AI"
        tabs={tabs} activeTab="overview" onTabChange={() => {}}
        tabsLayoutId="test-tabs"
      >body</Modal>
    )
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Overview/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /README/ })).toBeInTheDocument()
  })

  it('calls onTabChange when a tab is clicked', () => {
    const onTabChange = vi.fn()
    render(
      <Modal
        isOpen={true} onClose={() => {}} title="AI"
        tabs={tabs} activeTab="overview" onTabChange={onTabChange}
        tabsLayoutId="test-tabs"
      >body</Modal>
    )
    fireEvent.click(screen.getByRole('tab', { name: /README/ }))
    expect(onTabChange).toHaveBeenCalledWith('readme')
  })

  it('does not render tabs when tabs prop is absent', () => {
    render(<Modal isOpen={true} onClose={() => {}} title="AI">body</Modal>)
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })
})
