import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AIAssistantPasteDialog } from '../../src/components/AIAssistantPasteDialog'

function renderDialog(overrides = {}) {
  const props = {
    dialog: {
      status: 'collecting',
      sourceType: 'azure',
      parsed: { org: 'bruno', project: 'AWIP', repo: 'Cacadores' },
      answers: {},
      nextField: 'targetOrg',
    },
    onAnswer: vi.fn(),
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
    ...overrides,
  }
  return { props, ...render(<AIAssistantPasteDialog {...props} />) }
}

describe('AIAssistantPasteDialog', () => {
  it('renders the parsed Azure preview when collecting', () => {
    renderDialog()
    expect(screen.getByText(/azure devops/i)).toBeInTheDocument()
    expect(screen.getByText(/bruno/)).toBeInTheDocument()
    expect(screen.getByText(/AWIP/)).toBeInTheDocument()
    expect(screen.getByText(/Cacadores/)).toBeInTheDocument()
  })

  it('renders the first dynamic question (targetOrg)', () => {
    renderDialog()
    expect(screen.getByRole('textbox', { name: /github.*org.*destino/i })).toBeInTheDocument()
  })

  it('calls onAnswer with the field and value when user submits a question', () => {
    const { props } = renderDialog()
    const input = screen.getByRole('textbox', { name: /github.*org/i })
    fireEvent.change(input, { target: { value: 'bolalabs' } })
    fireEvent.submit(input.closest('form'))
    expect(props.onAnswer).toHaveBeenCalledWith('targetOrg', 'bolalabs')
  })

  it('renders the second question when nextField is targetName', () => {
    renderDialog({
      dialog: {
        status: 'collecting',
        sourceType: 'azure',
        parsed: { org: 'bruno', project: 'AWIP', repo: 'Cacadores' },
        answers: { targetOrg: 'bolalabs' },
        nextField: 'targetName',
      },
    })
    expect(screen.getByRole('textbox', { name: /nome final.*repo/i })).toBeInTheDocument()
  })

  it('renders the confirm button when status is ready', () => {
    renderDialog({
      dialog: {
        status: 'ready',
        sourceType: 'azure',
        parsed: { org: 'bruno', project: 'AWIP', repo: 'Cacadores' },
        answers: { targetOrg: 'bolalabs', targetName: 'Cacadores' },
        nextField: null,
      },
    })
    expect(screen.getByRole('button', { name: /abrir wizard/i })).toBeInTheDocument()
  })

  it('calls onConfirm when the confirm button is clicked', () => {
    const { props } = renderDialog({
      dialog: {
        status: 'ready',
        sourceType: 'azure',
        parsed: { org: 'bruno', project: 'AWIP', repo: 'Cacadores' },
        answers: { targetOrg: 'bolalabs', targetName: 'Cacadores' },
        nextField: null,
      },
    })
    fireEvent.click(screen.getByRole('button', { name: /abrir wizard/i }))
    expect(props.onConfirm).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel when the cancel button is clicked', () => {
    const { props } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: /cancelar/i }))
    expect(props.onCancel).toHaveBeenCalledTimes(1)
  })

  it('ignores submit when the input is empty (does not fire onAnswer)', () => {
    const { props } = renderDialog()
    const input = screen.getByRole('textbox', { name: /github.*org/i })
    fireEvent.submit(input.closest('form'))
    expect(props.onAnswer).not.toHaveBeenCalled()
  })

  it('renders a GitHub preview when sourceType=github', () => {
    renderDialog({
      dialog: {
        status: 'collecting',
        sourceType: 'github',
        parsed: { owner: 'bolalabs', repo: 'BolaLabs' },
        answers: {},
        nextField: 'targetOrg',
      },
    })
    expect(screen.getAllByText(/github/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/bolalabs/)).toBeInTheDocument()
    expect(screen.getByText(/BolaLabs/)).toBeInTheDocument()
  })
})
