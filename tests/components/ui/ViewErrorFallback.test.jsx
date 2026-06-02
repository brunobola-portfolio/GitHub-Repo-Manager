import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ViewErrorFallback } from '@/components/ui/ViewErrorFallback'
import { onAppEvent, APP_EVENTS } from '../../../src/utils/appEvents'

describe('ViewErrorFallback', () => {
  let originalLocation

  beforeEach(() => {
    originalLocation = window.location
    // Replace window.location so we can spy on reload/assign without the
    // jsdom/happy-dom navigation guard complaining.
    delete window.location
    window.location = { ...originalLocation, reload: vi.fn(), assign: vi.fn() }
  })

  afterEach(() => {
    window.location = originalLocation
    vi.restoreAllMocks()
  })

  it('renders the viewName in the heading', () => {
    render(<ViewErrorFallback viewName="Repository Detail" />)
    expect(
      screen.getByText(/Something went wrong in Repository Detail/i)
    ).toBeInTheDocument()
  })

  it('falls back to "this view" when viewName is not provided', () => {
    render(<ViewErrorFallback />)
    expect(screen.getByText(/Something went wrong in this view/i)).toBeInTheDocument()
  })

  it('renders short guidance and both action buttons', () => {
    render(<ViewErrorFallback viewName="Dashboard" />)
    expect(screen.getByText(/Try reloading this view or return home/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Go to Dashboard/i })).toBeInTheDocument()
  })

  it('invokes onRetry when Retry is clicked', () => {
    const onRetry = vi.fn()
    render(<ViewErrorFallback viewName="X" onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('reloads the page when Retry is clicked without an onRetry handler', () => {
    render(<ViewErrorFallback viewName="X" />)
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }))
    expect(window.location.reload).toHaveBeenCalledTimes(1)
  })

  it('invokes onGoHome when "Go to Dashboard" is clicked', () => {
    const onGoHome = vi.fn()
    render(<ViewErrorFallback viewName="X" onGoHome={onGoHome} />)
    fireEvent.click(screen.getByRole('button', { name: /Go to Dashboard/i }))
    expect(onGoHome).toHaveBeenCalledTimes(1)
  })

  it('dispatches app:navigate-dashboard event when no onGoHome provided', () => {
    const listener = vi.fn()
    const off = onAppEvent(APP_EVENTS.NAVIGATE_DASHBOARD, listener)
    render(<ViewErrorFallback viewName="X" />)
    fireEvent.click(screen.getByRole('button', { name: /Go to Dashboard/i }))
    expect(listener).toHaveBeenCalledTimes(1)
    off()
  })

  it('shows error.message inside collapsed details when provided', () => {
    render(
      <ViewErrorFallback
        viewName="X"
        error={new Error('Boom: undefined is not a function')}
      />
    )
    expect(screen.getByText(/Technical details/i)).toBeInTheDocument()
    expect(
      screen.getByText(/Boom: undefined is not a function/i)
    ).toBeInTheDocument()
  })

  it('omits the details section when there is no error', () => {
    render(<ViewErrorFallback viewName="X" />)
    expect(screen.queryByText(/Technical details/i)).not.toBeInTheDocument()
  })

  it('exposes role="alert" for assistive tech', () => {
    render(<ViewErrorFallback viewName="X" />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
