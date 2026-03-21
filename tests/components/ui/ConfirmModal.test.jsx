import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ConfirmModal } from '@/components/ui/ConfirmModal'

// Mock useFocusTrap
vi.mock('@/hooks/useFocusTrap', () => ({
  useFocusTrap: () => ({ current: null })
}))

describe('ConfirmModal', () => {
  let onClose, onConfirm

  beforeEach(() => {
    onClose = vi.fn()
    onConfirm = vi.fn().mockResolvedValue(undefined)
  })

  it('does not render when closed', () => {
    render(<ConfirmModal isOpen={false} onClose={onClose} onConfirm={onConfirm} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders when open with title and message', () => {
    render(
      <ConfirmModal
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
        title="Delete Repo?"
        message="This action cannot be undone."
      />
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Delete Repo?')).toBeInTheDocument()
    expect(screen.getByText('This action cannot be undone.')).toBeInTheDocument()
  })

  it('calls onConfirm when confirm button is clicked', async () => {
    render(
      <ConfirmModal isOpen={true} onClose={onClose} onConfirm={onConfirm} />
    )
    fireEvent.click(screen.getByText('Confirm'))
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1)
    })
  })

  it('calls onClose when cancel button is clicked', () => {
    render(
      <ConfirmModal isOpen={true} onClose={onClose} onConfirm={onConfirm} />
    )
    fireEvent.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('prevents double-click on confirm', async () => {
    // Make onConfirm take some time
    onConfirm = vi.fn(() => new Promise(r => setTimeout(r, 100)))

    render(
      <ConfirmModal isOpen={true} onClose={onClose} onConfirm={onConfirm} />
    )

    const confirmBtn = screen.getByText('Confirm')
    fireEvent.click(confirmBtn)
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1)
    })
  })

  it('shows input when requiresInput is set', () => {
    render(
      <ConfirmModal
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
        requiresInput="DELETE"
      />
    )
    expect(screen.getByPlaceholderText('DELETE')).toBeInTheDocument()
  })

  it('blocks confirm when input does not match', async () => {
    render(
      <ConfirmModal
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
        requiresInput="DELETE"
      />
    )
    // Click without typing
    fireEvent.click(screen.getByText('Confirm'))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByText('Please type "DELETE" to confirm')).toBeInTheDocument()
  })

  it('allows confirm when input matches', async () => {
    render(
      <ConfirmModal
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
        requiresInput="DELETE"
      />
    )
    fireEvent.change(screen.getByPlaceholderText('DELETE'), { target: { value: 'DELETE' } })
    fireEvent.click(screen.getByText('Confirm'))
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1)
    })
  })

  it('renders custom button text', () => {
    render(
      <ConfirmModal
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
        confirmText="Yes, Delete"
        cancelText="Go Back"
      />
    )
    expect(screen.getByText('Yes, Delete')).toBeInTheDocument()
    expect(screen.getByText('Go Back')).toBeInTheDocument()
  })

  it('has correct aria attributes', () => {
    render(
      <ConfirmModal isOpen={true} onClose={onClose} onConfirm={onConfirm} title="Test" />
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-labelledby', 'confirm-modal-title')
    expect(dialog).toHaveAttribute('aria-describedby', 'confirm-modal-body')
  })

  it('disables buttons while submitting', async () => {
    onConfirm = vi.fn(() => new Promise(r => setTimeout(r, 200)))
    render(
      <ConfirmModal isOpen={true} onClose={onClose} onConfirm={onConfirm} />
    )

    fireEvent.click(screen.getByText('Confirm'))
    await waitFor(() => {
      expect(screen.getByText('Processing...')).toBeInTheDocument()
    })
  })
})
