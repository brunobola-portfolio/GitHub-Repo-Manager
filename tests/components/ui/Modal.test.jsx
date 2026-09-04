import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Modal } from '@/components/ui/Modal'
import { useFocusTrap } from '@/hooks/useFocusTrap'

vi.mock('@/hooks/useFocusTrap', () => ({
  useFocusTrap: vi.fn(() => ({ current: null }))
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

  it('applies size="2xl" viewport-aware max-width class', () => {
    const { container } = render(
      <Modal isOpen={true} onClose={() => {}} title="Hi" size="2xl">x</Modal>
    )
    // Wide tiers use a viewport-clamped max-width so big monitors don't leave
    // hundreds of pixels of dead space framing the dialog.
    expect(container.querySelector('[role="dialog"]').className).toMatch(/max-w-\[min\(90vw,1200px\)\]/)
  })

  it('applies size="3xl" viewport-aware max-width class', () => {
    const { container } = render(
      <Modal isOpen={true} onClose={() => {}} title="Hi" size="3xl">x</Modal>
    )
    expect(container.querySelector('[role="dialog"]').className).toMatch(/max-w-\[min\(92vw,1440px\)\]/)
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

  it('renders icon tile with the brand tint when iconGradient=primary', () => {
    const Icon = () => <svg data-testid="icon" />
    const { container } = render(
      <Modal isOpen={true} onClose={() => {}} title="Hi" icon={Icon} iconGradient="primary">x</Modal>
    )
    const iconTile = container.querySelector('[data-icon-tile="true"]')
    expect(iconTile).not.toBeNull()
    // Neutral-header redesign: tile is soft-tinted (bg-brand-100 in light,
    // bg-brand-500/15 in dark) rather than the prior bg-brand-600 solid.
    expect(iconTile.className).toMatch(/bg-brand-(100|500\/15)/)
  })
})

describe('Modal — semantic variants', () => {
  afterEach(() => { cleanup(); document.body.style.overflow = '' })

  // Soft-tinted icon tile communicates variant state — see
  // src/components/ui/_variants.js VARIANT_ICON_STYLES.
  const Icon = () => <svg data-testid="icon" />

  it.each([
    ['danger',  /bg-red-(100|500\/15)/],
    ['warning', /bg-amber-(100|500\/15)/],
    ['info',    /bg-brand-(100|500\/15)/],
    ['success', /bg-emerald-(100|500\/15)/],
  ])('renders %s variant with the matching soft-tinted icon tile', (variant, pattern) => {
    const { container } = render(
      <Modal isOpen={true} onClose={() => {}} title="X" icon={Icon} variant={variant}>x</Modal>
    )
    const iconTile = container.querySelector('[data-icon-tile="true"]')
    expect(iconTile).not.toBeNull()
    expect(iconTile.className).toMatch(pattern)
  })

  it('iconGradient="none" falls through to the variant tile (variant wins)', () => {
    // ConfirmModal sets iconGradient="none" so the danger variant's red tile
    // shows through. Guards against accidental "none = neutral slate" reading.
    const { container } = render(
      <Modal isOpen={true} onClose={() => {}} title="X" icon={Icon} variant="danger" iconGradient="none">x</Modal>
    )
    const iconTile = container.querySelector('[data-icon-tile="true"]')
    expect(iconTile.className).toMatch(/bg-red-(100|500\/15)/)
  })

  it('iconGradient="primary" overrides a danger variant (affordance wins over semantic)', () => {
    const { container } = render(
      <Modal isOpen={true} onClose={() => {}} title="X" icon={Icon} variant="danger" iconGradient="primary">x</Modal>
    )
    const iconTile = container.querySelector('[data-icon-tile="true"]')
    expect(iconTile.className).toMatch(/bg-brand-(100|500\/15)/)
    expect(iconTile.className).not.toMatch(/bg-red-/)
  })

  it('default variant + iconGradient="none" renders the neutral slate tile', () => {
    const { container } = render(
      <Modal isOpen={true} onClose={() => {}} title="X" icon={Icon} variant="default" iconGradient="none">x</Modal>
    )
    const iconTile = container.querySelector('[data-icon-tile="true"]')
    expect(iconTile.className).toMatch(/bg-slate-(200|700)/)
  })

  it('unknown variant string falls back to the default neutral tile', () => {
    const { container } = render(
      <Modal isOpen={true} onClose={() => {}} title="X" icon={Icon} variant="bogus">x</Modal>
    )
    const iconTile = container.querySelector('[data-icon-tile="true"]')
    expect(iconTile.className).toMatch(/bg-slate-(200|700)/)
  })
})

describe('Modal — interactions', () => {
  afterEach(() => { cleanup(); document.body.style.overflow = '' })

  it('fires onClose when the close button is clicked', () => {
    const onClose = vi.fn()
    render(<Modal isOpen={true} onClose={onClose} title="Hi">x</Modal>)
    fireEvent.click(screen.getByRole('button', { name: /close modal/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('hides the close button when showCloseButton=false', () => {
    render(<Modal isOpen={true} onClose={() => {}} title="Hi" showCloseButton={false}>x</Modal>)
    expect(screen.queryByRole('button', { name: /close modal/i })).not.toBeInTheDocument()
  })

  it('fires onClose when the backdrop is clicked (default)', () => {
    const onClose = vi.fn()
    const { container } = render(<Modal isOpen={true} onClose={onClose} title="Hi">x</Modal>)
    const backdrop = container.querySelector('[data-modal-backdrop="true"]')
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does NOT fire onClose on backdrop click when closeOnBackdrop=false', () => {
    const onClose = vi.fn()
    const { container } = render(
      <Modal isOpen={true} onClose={onClose} title="Hi" closeOnBackdrop={false}>x</Modal>
    )
    const backdrop = container.querySelector('[data-modal-backdrop="true"]')
    fireEvent.click(backdrop)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Escape still closes a modal that declines backdrop clicks', () => {
    // disableEscape used to default to !closeOnBackdrop, which left sixteen
    // dialogs (AI Insights, Community Health, the keyboard-shortcuts help
    // itself) deaf to the keyboard's first dismissal gesture.
    // The trap is mocked here (it owns the document keydown listener), so
    // the contract under test is the option Modal hands it.
    const onClose = vi.fn()
    render(
      <Modal isOpen={true} onClose={onClose} title="Hi" closeOnBackdrop={false}>x</Modal>
    )
    expect(useFocusTrap).toHaveBeenLastCalledWith(
      true,
      onClose,
      expect.objectContaining({ disableEscape: false }),
    )
  })

  it('forwards isBusy to aria-busy on the body region', () => {
    const { container } = render(<Modal isOpen={true} onClose={() => {}} title="Hi" isBusy>body</Modal>)
    // Body is the only descendant with role attributes — narrow via the
    // ds-modal-body class the body div carries.
    const body = container.querySelector('.ds-modal-body')
    expect(body).not.toBeNull()
    expect(body.getAttribute('aria-busy')).toBe('true')
  })

  it('omits aria-busy when isBusy is falsy', () => {
    const { container } = render(<Modal isOpen={true} onClose={() => {}} title="Hi">body</Modal>)
    const body = container.querySelector('.ds-modal-body')
    expect(body.getAttribute('aria-busy')).toBeNull()
  })
})

describe('Modal — title edge cases', () => {
  afterEach(() => { cleanup(); document.body.style.overflow = '' })

  it('renders the h2 with the title id for a non-empty string title', () => {
    const { container } = render(<Modal isOpen={true} onClose={() => {}} title="Hello">x</Modal>)
    const dialog = container.querySelector('[role="dialog"]')
    const labelledBy = dialog.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    const heading = container.querySelector(`#${labelledBy}`)
    expect(heading).not.toBeNull()
    expect(heading.tagName).toBe('H2')
    expect(heading.textContent).toBe('Hello')
  })

  it('skips the h2 AND aria-labelledby when title is empty string', () => {
    // Previously an empty title rendered an empty <h2> that aria-labelledby
    // still pointed at — screen readers announced "" as the dialog label.
    const { container } = render(<Modal isOpen={true} onClose={() => {}} title="">x</Modal>)
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog.getAttribute('aria-labelledby')).toBeNull()
    expect(container.querySelector('h2')).toBeNull()
  })

  it('skips the h2 AND aria-labelledby when title is whitespace only', () => {
    const { container } = render(<Modal isOpen={true} onClose={() => {}} title="   ">x</Modal>)
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog.getAttribute('aria-labelledby')).toBeNull()
    expect(container.querySelector('h2')).toBeNull()
  })

  it('renders a ReactNode title without imposing aria-labelledby', () => {
    // ReactNode titles let callers compose their own a11y label; Modal does
    // not assume it knows the text content.
    const node = <span data-testid="custom-title">Custom heading</span>
    const { container } = render(<Modal isOpen={true} onClose={() => {}} title={node}>x</Modal>)
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog.getAttribute('aria-labelledby')).toBeNull()
    expect(screen.getByTestId('custom-title')).toBeInTheDocument()
  })
})

describe('Modal — trapped-close dev warning', () => {
  let originalWarn
  let originalDev
  beforeEach(() => {
    originalWarn = console.warn
    console.warn = vi.fn()
    // Force the DEV branch on regardless of the test runner's env so the
    // guard fires deterministically.
    originalDev = import.meta.env.DEV
    import.meta.env.DEV = true
  })
  afterEach(() => {
    console.warn = originalWarn
    import.meta.env.DEV = originalDev
    cleanup()
    document.body.style.overflow = ''
  })

  it('warns in dev when ALL dismiss vectors are disabled', () => {
    render(
      <Modal
        isOpen={true}
        onClose={() => {}}
        title="Trapped"
        showCloseButton={false}
        closeOnBackdrop={false}
        disableEscape={true}
      >
        x
      </Modal>
    )
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[Modal]'))
  })

  it('does NOT warn when at least one dismiss vector remains', () => {
    render(
      <Modal
        isOpen={true}
        onClose={() => {}}
        title="Has escape"
        showCloseButton={false}
        closeOnBackdrop={false}
        disableEscape={false}
      >
        x
      </Modal>
    )
    expect(console.warn).not.toHaveBeenCalled()
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
