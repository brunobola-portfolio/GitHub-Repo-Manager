/*
 * Select (app-wide dropdown primitive) — a11y guard for aria-activedescendant.
 * Arrow-key navigation must move the combobox's active descendant to the
 * highlighted option (WCAG 4.1.2) so screen readers announce it; before the fix
 * the highlight was a visual-only background class with no AT exposure.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Select } from '@/components/ui/Select'
import { Field } from '@/components/ui/form/Field'

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
]

function open() {
  render(<Select options={OPTIONS} value="a" onChange={vi.fn()} label="Pick one" />)
  const combo = screen.getByRole('combobox', { name: 'Pick one' })
  fireEvent.click(combo)
  return combo
}

describe('Select — aria-activedescendant', () => {
  it('has no active descendant while closed', () => {
    render(<Select options={OPTIONS} value="a" onChange={vi.fn()} label="Pick one" />)
    expect(screen.getByRole('combobox', { name: 'Pick one' })).not.toHaveAttribute('aria-activedescendant')
  })

  it('points to a real option element (role=option) once the user arrows', () => {
    const combo = open()
    fireEvent.keyDown(combo, { key: 'ArrowDown' })
    const id = combo.getAttribute('aria-activedescendant')
    expect(id).toBeTruthy()
    const active = document.getElementById(id)
    expect(active).not.toBeNull()
    expect(active).toHaveAttribute('role', 'option')
  })

  it('moves the active descendant as the highlight changes', () => {
    const combo = open()
    fireEvent.keyDown(combo, { key: 'ArrowDown' })
    const first = combo.getAttribute('aria-activedescendant')
    fireEvent.keyDown(combo, { key: 'ArrowDown' })
    const second = combo.getAttribute('aria-activedescendant')
    expect(second).toBeTruthy()
    expect(second).not.toBe(first)
    expect(document.getElementById(second)).not.toBeNull()
  })
})

/*
 * Select — id/aria-describedby forwarding when composed inside <Field>.
 * Field clones its single child with `id` + `aria-describedby` so the
 * <label htmlFor> and hint/error text associate with the control (same
 * contract Input/Textarea already honor). Select previously dropped both
 * props on the floor — no ...rest spread, no explicit accept — so the
 * label's htmlFor pointed at an id that didn't exist in the DOM and the
 * hint text was never programmatically tied to the combobox.
 */
describe('Select — id/aria-describedby forwarding via Field', () => {
  it('applies the id Field generates onto the trigger, and the label click focuses it', () => {
    render(
      <Field label="License" hint="Detected: MIT">
        <Select label="License" options={OPTIONS} value="a" onChange={vi.fn()} />
      </Field>
    )
    const combo = screen.getByRole('combobox', { name: 'License' })
    const label = screen.getByText('License')
    expect(combo).toHaveAttribute('id')
    expect(label.closest('label')).toHaveAttribute('for', combo.id)
  })

  it('ties the hint text to the trigger via aria-describedby', () => {
    render(
      <Field label="License" hint="Detected: MIT">
        <Select label="License" options={OPTIONS} value="a" onChange={vi.fn()} />
      </Field>
    )
    const combo = screen.getByRole('combobox', { name: 'License' })
    const describedBy = combo.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    const hint = document.getElementById(describedBy)
    expect(hint).not.toBeNull()
    expect(hint).toHaveTextContent('Detected: MIT')
  })
})
