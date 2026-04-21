import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ErrorBoundary from '@/components/ErrorBoundary'
import { ViewErrorFallback } from '@/components/ui/ViewErrorFallback'

// Silence the expected React error logs that come from throwing render.
const originalError = console.error
beforeEach(() => {
  console.error = vi.fn()
  global.fetch = vi.fn().mockResolvedValue({ ok: true })
})
afterEach(() => {
  console.error = originalError
  vi.restoreAllMocks()
})

/**
 * Shell component representing the persistent app chrome (header, sidebar).
 * The point of per-view error boundaries is that crashing a lazy child
 * leaves this intact.
 */
function Shell({ children }) {
  return (
    <div>
      <header data-testid="app-header">App Header</header>
      <nav data-testid="app-nav">Nav</nav>
      <main data-testid="app-main">{children}</main>
    </div>
  )
}

describe('ErrorBoundary + ViewErrorFallback integration', () => {
  it('keeps the outer shell rendered when a lazy child throws', () => {
    function Broken() {
      throw new TypeError('Cannot read properties of undefined (reading "map")')
    }

    render(
      <Shell>
        <ErrorBoundary fallback={<ViewErrorFallback viewName="Broken View" />}>
          <Broken />
        </ErrorBoundary>
      </Shell>
    )

    // Shell stays mounted
    expect(screen.getByTestId('app-header')).toBeInTheDocument()
    expect(screen.getByTestId('app-nav')).toBeInTheDocument()

    // Fallback replaced only the broken subtree
    expect(
      screen.getByText(/Something went wrong in Broken View/i)
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Go to Dashboard/i })).toBeInTheDocument()
  })

  it('re-renders the child when the user clicks Retry after fixing the error condition', () => {
    // A toggle in module scope lets us flip "throwing" off between renders.
    let shouldThrow = true
    function Conditional() {
      if (shouldThrow) {
        throw new Error('Render crash')
      }
      return <div data-testid="recovered">Recovered content</div>
    }

    render(
      <Shell>
        <ErrorBoundary fallback={<ViewErrorFallback viewName="Flaky" />}>
          <Conditional />
        </ErrorBoundary>
      </Shell>
    )

    // First render: fallback visible, shell still mounted.
    expect(screen.getByText(/Something went wrong in Flaky/i)).toBeInTheDocument()
    expect(screen.getByTestId('app-header')).toBeInTheDocument()
    expect(screen.queryByTestId('recovered')).not.toBeInTheDocument()

    // Fix the underlying problem, then retry.
    shouldThrow = false
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }))

    // Fallback is replaced by the recovered child; shell unchanged.
    expect(screen.getByTestId('recovered')).toBeInTheDocument()
    expect(screen.queryByText(/Something went wrong in Flaky/i)).not.toBeInTheDocument()
    expect(screen.getByTestId('app-header')).toBeInTheDocument()
  })

  it('isolates failures — a crashing boundary does not take out sibling views', () => {
    function Broken() {
      throw new Error('Sibling crash')
    }

    render(
      <Shell>
        <ErrorBoundary fallback={<ViewErrorFallback viewName="Crashy" />}>
          <Broken />
        </ErrorBoundary>
        <ErrorBoundary fallback={<ViewErrorFallback viewName="Safe" />}>
          <div data-testid="safe-sibling">Still here</div>
        </ErrorBoundary>
      </Shell>
    )

    expect(screen.getByText(/Something went wrong in Crashy/i)).toBeInTheDocument()
    expect(screen.getByTestId('safe-sibling')).toBeInTheDocument()
    expect(screen.queryByText(/Something went wrong in Safe/i)).not.toBeInTheDocument()
  })

  it('surfaces error.message in the collapsed details block', () => {
    function Broken() {
      throw new Error('my specific message')
    }

    render(
      <ErrorBoundary fallback={<ViewErrorFallback viewName="Detailed" />}>
        <Broken />
      </ErrorBoundary>
    )

    expect(screen.getByText(/Technical details/i)).toBeInTheDocument()
    expect(screen.getByText(/my specific message/i)).toBeInTheDocument()
  })
})
