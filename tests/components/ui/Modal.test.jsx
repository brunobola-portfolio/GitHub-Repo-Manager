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

  it('size="full" applies a near-full-viewport width class for diff-viewer use', () => {
    const { container } = render(
      <Modal isOpen={true} onClose={() => {}} title="Hi" size="full">x</Modal>
    )
    const dialog = container.querySelector('[role="dialog"]')
    // Tailwind arbitrary value with min() is encoded with brackets — matches the
    // SIZE_CLASSES.full / SHEET_SIZE_CLASSES.full literal class string.
    expect(dialog.className).toMatch(/max-w-\[min\(96vw,1600px\)\]/)
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

describe('Modal — staggerChildren and iconGradient', () => {
  afterEach(() => { cleanup(); document.body.style.overflow = '' })

  it('wraps body in stagger container when staggerChildren=true', () => {
    const { container } = render(
      <Modal isOpen={true} onClose={() => {}} title="Hi" staggerChildren>
        <div data-testid="child">x</div>
      </Modal>
    )
    expect(container.querySelector('[data-stagger-root="true"]')).not.toBeNull()
  })

  it('does not add stagger wrapper by default', () => {
    const { container } = render(
      <Modal isOpen={true} onClose={() => {}} title="Hi">x</Modal>
    )
    expect(container.querySelector('[data-stagger-root="true"]')).toBeNull()
  })

  it('renders icon with primary gradient class when iconGradient=primary', () => {
    const Icon = () => <svg data-testid="icon" />
    const { container } = render(
      <Modal isOpen={true} onClose={() => {}} title="Hi" icon={Icon} iconGradient="primary">x</Modal>
    )
    const iconTile = container.querySelector('[data-icon-tile="true"]')
    expect(iconTile).not.toBeNull()
    expect(iconTile.className).toMatch(/from-indigo-500/)
  })
})

describe('Modal — mobileVariant', () => {
  afterEach(() => { cleanup(); document.body.style.overflow = '' })

  it('applies sheet classes when mobileVariant=sheet', () => {
    const { container } = render(
      <Modal isOpen={true} onClose={() => {}} title="Hi" mobileVariant="sheet">x</Modal>
    )
    const backdrop = container.querySelector('[data-modal-backdrop="true"]')
    expect(backdrop.className).toMatch(/md:items-center/)
    expect(backdrop.className).toMatch(/items-end/)

    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog.className).toMatch(/max-md:rounded-t-3xl/)
    expect(dialog.className).toMatch(/max-md:rounded-b-none/)
  })

  it('applies centered classes when mobileVariant=centered', () => {
    const { container } = render(
      <Modal isOpen={true} onClose={() => {}} title="Hi" mobileVariant="centered">x</Modal>
    )
    const backdrop = container.querySelector('[data-modal-backdrop="true"]')
    expect(backdrop.className).toMatch(/items-center/)
    expect(backdrop.className).not.toMatch(/items-end/)
  })

  it('defaults to sheet on mobile', () => {
    const { container } = render(
      <Modal isOpen={true} onClose={() => {}} title="Hi">x</Modal>
    )
    const backdrop = container.querySelector('[data-modal-backdrop="true"]')
    expect(backdrop.className).toMatch(/items-end/)
  })
})
