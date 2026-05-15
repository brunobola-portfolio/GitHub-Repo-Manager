import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { Tooltip } from '../../../src/components/ui/Tooltip'

describe('Tooltip', () => {
  it('appears after 300ms hover', async () => {
    vi.useFakeTimers()
    render(<Tooltip label="Sync repos"><button>Sync</button></Tooltip>)
    fireEvent.mouseEnter(screen.getByText('Sync'))
    expect(screen.queryByText('Sync repos')).not.toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(300) })
    expect(screen.getByText('Sync repos')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('hides immediately on mouseleave', async () => {
    vi.useFakeTimers()
    render(<Tooltip label="Sync repos"><button>Sync</button></Tooltip>)
    fireEvent.mouseEnter(screen.getByText('Sync'))
    act(() => { vi.advanceTimersByTime(300) })
    fireEvent.mouseLeave(screen.getByText('Sync'))
    expect(screen.queryByText('Sync repos')).not.toBeInTheDocument()
    vi.useRealTimers()
  })
})
