import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RiskRail } from '@/components/PRReview/FileTree/RiskRail'

const FILES = [
  { filename: 'src/a.js', additions: 1, deletions: 0 },
  { filename: 'src/auth/session.js', additions: 40, deletions: 10 },
  { filename: 'src/c.js', additions: 0, deletions: 3 },
]

describe('RiskRail — file-level risk heat rail', () => {
  it('renders one clickable segment per file, labelled with its risk level', () => {
    render(
      <RiskRail
        files={FILES}
        aiRiskMap={{ 'src/auth/session.js': 'critical' }}
        heuristicMap={{ 'src/a.js': 0, 'src/c.js': 1 }}
        onFileSelect={vi.fn()}
      />,
    )
    const segments = screen.getAllByRole('button')
    expect(segments).toHaveLength(FILES.length)
    expect(screen.getByRole('button', { name: /src\/auth\/session\.js.*Critical risk/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /src\/a\.js.*Low risk/i })).toBeInTheDocument()
  })

  it('prefers AI risk over the heuristic score when both are present', () => {
    render(
      <RiskRail
        files={[{ filename: 'src/a.js', additions: 1, deletions: 0 }]}
        aiRiskMap={{ 'src/a.js': 'high' }}
        heuristicMap={{ 'src/a.js': 0 }}
        onFileSelect={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /src\/a\.js.*High risk/i })).toBeInTheDocument()
  })

  it('jumps to the file (calls onFileSelect) when a segment is clicked', async () => {
    const user = userEvent.setup()
    const onFileSelect = vi.fn()
    render(<RiskRail files={FILES} onFileSelect={onFileSelect} />)

    await user.click(screen.getByRole('button', { name: /src\/c\.js/i }))
    expect(onFileSelect).toHaveBeenCalledWith('src/c.js')
  })

  it('marks the active file segment with aria-current', () => {
    render(<RiskRail files={FILES} activeFile="src/c.js" onFileSelect={vi.fn()} />)
    expect(screen.getByRole('button', { name: /src\/c\.js/i })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: /src\/a\.js/i })).not.toHaveAttribute('aria-current')
  })

  it('renders nothing when there are no files', () => {
    const { container } = render(<RiskRail files={[]} onFileSelect={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
})
