/*
 * FileRiskBadge — risk was conveyed by colour alone via a `title` on a
 * non-interactive span (not announced to AT). It now exposes a non-colour
 * accessible name via role=img + aria-label (WCAG 1.4.1 / 4.1.2).
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FileRiskBadge } from '@/components/PRReview/AIInsights/FileRiskBadge'

describe('FileRiskBadge — non-colour accessible name', () => {
  it('exposes the AI risk level via role=img + aria-label', () => {
    render(<FileRiskBadge aiRisk="high" />)
    expect(screen.getByRole('img', { name: /AI risk: high/i })).toBeInTheDocument()
  })

  it('labels the heuristic score', () => {
    render(<FileRiskBadge heuristicScore={4} />)
    expect(screen.getByRole('img', { name: /Heuristic risk score: 4\/5/i })).toBeInTheDocument()
  })

  it('labels unknown risk when no data is provided', () => {
    render(<FileRiskBadge />)
    expect(screen.getByRole('img', { name: /Risk unknown/i })).toBeInTheDocument()
  })
})
