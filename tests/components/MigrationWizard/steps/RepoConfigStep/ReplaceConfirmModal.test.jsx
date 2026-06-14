import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReplaceConfirmModal } from '../../../../../src/components/MigrationWizard/steps/RepoConfigStep/ReplaceConfirmModal'

describe('ReplaceConfirmModal', () => {
  const base = { isOpen: true, repoFullName: 'BolaLabs/AITOOL', onCancel: vi.fn(), onConfirm: vi.fn() }

  it('shows the destructive warning with the repo name', () => {
    render(<ReplaceConfirmModal {...base} />)
    expect(screen.getByText(/permanently delete/i)).toBeInTheDocument()
    expect(screen.getAllByText(/BolaLabs\/AITOOL/).length).toBeGreaterThan(0)
  })

  it('keeps confirm disabled until the exact name is typed', () => {
    const onConfirm = vi.fn()
    render(<ReplaceConfirmModal {...base} onConfirm={onConfirm} />)
    const confirm = screen.getByRole('button', { name: /delete & replace/i })
    expect(confirm).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/type the repository name/i), { target: { value: 'wrong' } })
    expect(confirm).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/type the repository name/i), { target: { value: 'BolaLabs/AITOOL' } })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel from the cancel button', () => {
    const onCancel = vi.fn()
    render(<ReplaceConfirmModal {...base} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
