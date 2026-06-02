import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Download } from 'lucide-react'
import { WizardPanel } from '@/components/ui/WizardPanel'

// Mirror the Modal test setup: the focus trap depends on real DOM focus
// management that jsdom doesn't fully model, so we stub it to a plain ref.
vi.mock('@/hooks/useFocusTrap', () => ({
  useFocusTrap: () => ({ current: null }),
}))
vi.mock('@/hooks/useMobileKeyboardFix', () => ({
  useMobileKeyboardFix: () => {},
}))

const base = {
  isOpen: true,
  onClose: () => {},
  title: 'Import Repository',
  icon: Download,
}

afterEach(() => {
  cleanup()
  document.body.style.overflow = ''
})

describe('WizardPanel — floating (restored desktop) mode', () => {
  it('renders the resize grip when floating', () => {
    render(<WizardPanel {...base} isMaximized={false} isMobile={false}>body</WizardPanel>)
    expect(screen.getByTestId('wizard-resize-handle')).toBeInTheDocument()
  })

  it('makes the title bar a drag handle (grab cursor)', () => {
    render(<WizardPanel {...base} isMaximized={false} isMobile={false}>body</WizardPanel>)
    const titlebar = screen.getByTestId('wizard-titlebar')
    expect(titlebar.className).toMatch(/cursor-grab/)
    expect(titlebar.className).toMatch(/touch-none/)
  })

  it('uses the lighter wizard backdrop (reduced blur, not the heavy modal blur)', () => {
    render(<WizardPanel {...base} isMaximized={false} isMobile={false}>body</WizardPanel>)
    const backdrop = screen.getByTestId('wizard-backdrop')
    expect(backdrop.className).toMatch(/backdrop-blur-\[2px\]/)
    expect(backdrop.className).not.toMatch(/backdrop-blur-md/)
  })

  it('still closes from the header button while floating (drag guard ignores buttons)', () => {
    const onClose = vi.fn()
    render(<WizardPanel {...base} onClose={onClose} isMaximized={false} isMobile={false}>body</WizardPanel>)
    fireEvent.click(screen.getByRole('button', { name: /close wizard/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('WizardPanel — maximized / mobile (no drag or resize)', () => {
  it('omits the resize grip when maximized', () => {
    render(<WizardPanel {...base} isMaximized={true} isMobile={false}>body</WizardPanel>)
    expect(screen.queryByTestId('wizard-resize-handle')).not.toBeInTheDocument()
  })

  it('leaves the title bar non-draggable when maximized', () => {
    render(<WizardPanel {...base} isMaximized={true} isMobile={false}>body</WizardPanel>)
    expect(screen.getByTestId('wizard-titlebar').className).not.toMatch(/cursor-grab/)
  })

  it('treats mobile as maximized — no resize grip even when isMaximized is false', () => {
    render(<WizardPanel {...base} isMaximized={false} isMobile={true}>body</WizardPanel>)
    expect(screen.queryByTestId('wizard-resize-handle')).not.toBeInTheDocument()
  })
})
