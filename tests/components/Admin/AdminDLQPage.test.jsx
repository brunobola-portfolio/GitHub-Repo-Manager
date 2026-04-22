import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Toast — the page shows success/error toasts after retry/resolve. We stub
// the hook so tests can assert the right message was dispatched without
// needing a real ToastProvider in the render tree.
const mockToast = vi.hoisted(() => ({
  success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), custom: vi.fn(),
}))
vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: mockToast, toasts: [], dismissToast: vi.fn() }),
}))

// Framer — keep animations inert in tests (matches WorkBoardPage.test.jsx).
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    motion: new Proxy(actual.motion, {
      get(target, key) {
        if (typeof key === 'string' && !['div', 'a', 'button', 'span', 'tr'].includes(key)) {
          return target[key] ?? target.div
        }
        return target[key]
      },
    }),
    AnimatePresence: ({ children }) => children,
  }
})

// API client — the focus of this test is UI behaviour, not network. We
// mock every exported function so individual specs can tune responses.
// vi.hoisted is required so the mocks exist at the time vi.mock() is
// hoisted to the top of the module.
const mockApi = vi.hoisted(() => ({
  listEmailDLQ: vi.fn(),
  getEmailEntry: vi.fn(),
  retryEmailEntry: vi.fn(),
  resolveEmailEntry: vi.fn(),
  listWebhookDLQ: vi.fn(),
  getWebhookEntry: vi.fn(),
  retryWebhookEntry: vi.fn(),
  resolveWebhookEntry: vi.fn(),
}))
vi.mock('@/api/admin-dlq', () => mockApi)

import { AdminDLQPage } from '@/components/Admin/AdminDLQPage'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EMAIL_ROWS = [
  {
    id: 1,
    to_address: 'alice@example.com',
    subject: 'License key',
    attempts: 2,
    last_error: 'smtp timeout',
    created_at: '2026-04-01T12:00:00Z',
    next_retry_at: '2026-04-01T12:30:00Z',
    resolved_at: null,
  },
  {
    id: 2,
    to_address: 'bob@example.com',
    subject: 'Password reset',
    attempts: 5,
    last_error: 'relay blocked',
    created_at: '2026-04-02T08:00:00Z',
    next_retry_at: '2026-04-02T09:00:00Z',
    resolved_at: null,
  },
]

const WEBHOOK_ROWS = [
  {
    id: 10,
    delivery_id: 'abc-123',
    event_type: 'push',
    attempts: 3,
    last_error: 'handler threw',
    created_at: '2026-04-03T10:00:00Z',
    next_retry_at: '2026-04-03T10:15:00Z',
    resolved_at: null,
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.listEmailDLQ.mockResolvedValue(EMAIL_ROWS)
  mockApi.listWebhookDLQ.mockResolvedValue(WEBHOOK_ROWS)
  mockApi.retryEmailEntry.mockResolvedValue(EMAIL_ROWS[0])
  mockApi.resolveEmailEntry.mockResolvedValue({ resolved: true, id: 1 })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AdminDLQPage', () => {
  it('renders the email DLQ table by default with rows from the API', async () => {
    render(<AdminDLQPage />)

    expect(mockApi.listEmailDLQ).toHaveBeenCalledWith('false')
    await waitFor(() => {
      expect(screen.getByText('alice@example.com')).toBeInTheDocument()
    })
    expect(screen.getByText('License key')).toBeInTheDocument()
    expect(screen.getByText('bob@example.com')).toBeInTheDocument()
  })

  it('switches to webhook tab and loads webhook entries', async () => {
    render(<AdminDLQPage />)
    await waitFor(() => expect(screen.getByText('alice@example.com')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('tab', { name: /Webhook DLQ/i }))

    await waitFor(() => {
      expect(mockApi.listWebhookDLQ).toHaveBeenCalledWith('false')
    })
    expect(await screen.findByText('abc-123')).toBeInTheDocument()
    expect(screen.getByText('push')).toBeInTheDocument()
  })

  it('refetches when the resolved filter changes', async () => {
    render(<AdminDLQPage />)
    await waitFor(() => expect(mockApi.listEmailDLQ).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'Resolved' }))

    await waitFor(() => {
      expect(mockApi.listEmailDLQ).toHaveBeenCalledWith('true')
    })

    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    await waitFor(() => {
      expect(mockApi.listEmailDLQ).toHaveBeenCalledWith('all')
    })
  })

  it('retrying a row calls the API and shows a success toast', async () => {
    render(<AdminDLQPage />)
    await waitFor(() => expect(screen.getByText('alice@example.com')).toBeInTheDocument())

    // Two action buttons per row — grab the first retry button.
    const retryBtn = screen.getAllByRole('button', { name: 'Retry now' })[0]
    fireEvent.click(retryBtn)

    await waitFor(() => {
      expect(mockApi.retryEmailEntry).toHaveBeenCalledWith(1)
    })
    expect(mockToast.success).toHaveBeenCalledWith(expect.stringMatching(/#1 queued/))
  })

  it('renders the 403 admin-gate error state with bootstrap SQL', async () => {
    const err = new Error('Admin only')
    err.status = 403
    mockApi.listEmailDLQ.mockRejectedValueOnce(err)

    render(<AdminDLQPage />)

    await waitFor(() => {
      expect(screen.getByText(/Admin access required/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/UPDATE users SET is_admin/)).toBeInTheDocument()
  })

  it('renders an empty state when the API returns no rows', async () => {
    mockApi.listEmailDLQ.mockResolvedValueOnce([])
    render(<AdminDLQPage />)

    await waitFor(() => {
      expect(screen.getByText(/Nothing here/i)).toBeInTheDocument()
    })
  })

  it('opens the detail panel for a row and fetches the full entry', async () => {
    const full = { ...EMAIL_ROWS[0], body_text: 'Hello friend', body_html: '<p>Hello</p>' }
    mockApi.getEmailEntry.mockResolvedValueOnce(full)

    render(<AdminDLQPage />)
    await waitFor(() => expect(screen.getByText('alice@example.com')).toBeInTheDocument())

    const viewBtn = screen.getAllByRole('button', { name: 'View details' })[0]
    fireEvent.click(viewBtn)

    await waitFor(() => expect(mockApi.getEmailEntry).toHaveBeenCalledWith(1))
    // The side panel renders a dialog with the entry title + body
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Hello friend')).toBeInTheDocument()
  })
})
