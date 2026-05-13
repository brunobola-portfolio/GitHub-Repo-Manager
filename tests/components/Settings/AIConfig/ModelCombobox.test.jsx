import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'

const { ModelCombobox } = await import('../../../../src/components/Settings/AIConfig/ModelCombobox')

const SAMPLE_OPTIONS = [
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', tier: 'fast', description: 'Fast default', context: '1M', capabilities: [], legacy: false },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', tier: 'smart', description: 'Higher quality', context: '2M', capabilities: [], legacy: false },
]

// Controlled wrapper — ModelCombobox is stateless and needs a host to drive
// the filter via re-renders, just like the real Settings form.
function Harness({ initial = '', options = SAMPLE_OPTIONS, onChange, ...rest }) {
    const [v, setV] = useState(initial)
    return (
        <ModelCombobox
            value={v}
            onChange={(next) => { setV(next); onChange?.(next) }}
            options={options}
            placeholder="pick"
            {...rest}
        />
    )
}

describe('ModelCombobox', () => {
    it('renders the value as the input content', () => {
        render(<ModelCombobox value="gemini-2.5-flash" onChange={() => {}} options={SAMPLE_OPTIONS} placeholder="pick" />)
        expect(screen.getByRole('combobox')).toHaveValue('gemini-2.5-flash')
    })

    it('opens the dropdown on focus and lists every option', () => {
        render(<ModelCombobox value="" onChange={() => {}} options={SAMPLE_OPTIONS} placeholder="pick" />)
        fireEvent.focus(screen.getByRole('combobox'))
        // Curated entries appear as listbox options.
        expect(screen.getByText('Gemini 2.5 Flash')).toBeInTheDocument()
        expect(screen.getByText('Gemini 2.5 Pro')).toBeInTheDocument()
    })

    it('selecting an option calls onChange with the model id', () => {
        const onChange = vi.fn()
        render(<ModelCombobox value="" onChange={onChange} options={SAMPLE_OPTIONS} placeholder="pick" />)
        fireEvent.focus(screen.getByRole('combobox'))
        fireEvent.click(screen.getByText('Gemini 2.5 Pro'))
        expect(onChange).toHaveBeenCalledWith('gemini-2.5-pro')
    })

    it('typing filters the list', () => {
        render(<Harness />)
        const input = screen.getByRole('combobox')
        fireEvent.focus(input)
        fireEvent.change(input, { target: { value: 'pro' } })
        expect(screen.queryByText('Gemini 2.5 Flash')).not.toBeInTheDocument()
        expect(screen.getByText('Gemini 2.5 Pro')).toBeInTheDocument()
    })

    it('shows the "custom id" hint when value does not match any option', () => {
        render(<ModelCombobox value="my-custom-model" onChange={() => {}} options={SAMPLE_OPTIONS} placeholder="pick" />)
        expect(screen.getByText(/Using custom model id/i)).toBeInTheDocument()
    })

    it('does NOT show the custom hint when value matches a curated option', () => {
        render(<ModelCombobox value="gemini-2.5-flash" onChange={() => {}} options={SAMPLE_OPTIONS} placeholder="pick" />)
        expect(screen.queryByText(/Using custom model id/i)).not.toBeInTheDocument()
    })

    it('keyboard ArrowDown then Enter selects the highlighted option', () => {
        const onChange = vi.fn()
        render(<ModelCombobox value="" onChange={onChange} options={SAMPLE_OPTIONS} placeholder="pick" />)
        const input = screen.getByRole('combobox')
        fireEvent.focus(input)
        fireEvent.keyDown(input, { key: 'ArrowDown' })
        fireEvent.keyDown(input, { key: 'Enter' })
        expect(onChange).toHaveBeenCalledWith('gemini-2.5-flash')
    })

    it('Escape closes the dropdown', () => {
        render(<ModelCombobox value="" onChange={() => {}} options={SAMPLE_OPTIONS} placeholder="pick" />)
        const input = screen.getByRole('combobox')
        fireEvent.focus(input)
        expect(screen.getByText('Gemini 2.5 Flash')).toBeInTheDocument()
        act(() => { fireEvent.keyDown(input, { key: 'Escape' }) })
        expect(screen.queryByText('Gemini 2.5 Flash')).not.toBeInTheDocument()
    })

    it('degrades to a plain input when options is empty', () => {
        render(<ModelCombobox value="" onChange={() => {}} options={[]} placeholder="anything" />)
        const input = screen.getByPlaceholderText('anything')
        // No combobox role when there are no curated options.
        expect(input).not.toHaveAttribute('role', 'combobox')
    })

    it('renders the catalogue link when catalogueHref is set', () => {
        render(
            <ModelCombobox
                value=""
                onChange={() => {}}
                options={SAMPLE_OPTIONS}
                placeholder="pick"
                catalogueHref="https://openrouter.ai/models"
                catalogueLabel="Browse OpenRouter"
            />
        )
        fireEvent.focus(screen.getByRole('combobox'))
        const link = screen.getByRole('link', { name: /Browse OpenRouter/ })
        expect(link).toHaveAttribute('href', 'https://openrouter.ai/models')
    })
})
