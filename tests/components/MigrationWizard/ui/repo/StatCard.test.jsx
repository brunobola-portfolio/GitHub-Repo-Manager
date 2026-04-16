import { render, screen } from '@testing-library/react'
import { Package } from 'lucide-react'
import { describe, it, expect } from 'vitest'
import { StatCard } from '../../../../../src/components/MigrationWizard/ui/repo/StatCard'

describe('StatCard', () => {
  it('renders value and label', () => {
    render(<StatCard icon={Package} label="Repositories" value="12" />)
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('Repositories')).toBeInTheDocument()
  })

  it('applies tone color class to value', () => {
    render(<StatCard icon={Package} label="Warnings" value="3" tone="amber" />)
    expect(screen.getByText('3')).toHaveClass('text-amber-400')
  })

  it('falls back to indigo tone by default', () => {
    render(<StatCard icon={Package} label="Default" value="1" />)
    expect(screen.getByText('1')).toHaveClass('text-indigo-400')
  })
})
