import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// ErrorBoundary now reports via an async IIFE that fetches a CSRF token
// before POSTing telemetry. Stub the token fetch so it doesn't consume the
// test's global.fetch mock and we can assert the telemetry call directly.
vi.mock('@/utils/api', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, getCsrfToken: vi.fn(async () => 'csrf-test-token') }
})

import ErrorBoundary from '@/components/ErrorBoundary'

// Suppress console.error for expected errors
const originalError = console.error
beforeEach(() => {
  console.error = vi.fn()
  global.fetch = vi.fn().mockResolvedValue({ ok: true })
})
afterEach(() => {
  console.error = originalError
  vi.restoreAllMocks()
})

// A component that throws on demand
function ThrowingChild({ shouldThrow }) {
  if (shouldThrow) throw new Error('Test error')
  return <div>Child rendered</div>
}

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={false} />
      </ErrorBoundary>
    )
    expect(screen.getByText('Child rendered')).toBeInTheDocument()
  })

  it('renders error UI when child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>
    )
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('Test error')).toBeInTheDocument()
  })

  it('shows Try Again and Reload Page buttons', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>
    )
    expect(screen.getByText('Try Again')).toBeInTheDocument()
    expect(screen.getByText('Reload Page')).toBeInTheDocument()
  })

  it('resets error state when Try Again is clicked', () => {
    let shouldThrow = true
    function Conditional() {
      if (shouldThrow) throw new Error('Render error')
      return <div>Recovered</div>
    }

    render(
      <ErrorBoundary>
        <Conditional />
      </ErrorBoundary>
    )
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()

    // Fix the problem, then retry
    shouldThrow = false
    fireEvent.click(screen.getByText('Try Again'))
    expect(screen.getByText('Recovered')).toBeInTheDocument()
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
  })

  it('reports error to backend', async () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>
    )

    // The telemetry POST runs in an async IIFE (awaiting the CSRF token first),
    // so we wait for the call rather than asserting synchronously.
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/system/client-error',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf-test-token' })
        })
      )
    })
  })

  it('displays error message in fallback UI', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>
    )
    expect(screen.getByText('Test error')).toBeInTheDocument()
  })
})
