import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

// The panel sends a CSRF header on the allowlist POST; stub the token fetch
// so it doesn't consume the test's mocked fetch response (same pattern as
// tests/components/DevToolkit/QuickActions.test.jsx).
vi.mock('@/utils/api', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, getCsrfToken: vi.fn(async () => 'csrf-test-token') }
})

import AllowlistFixPanel from '@/components/ui/AllowlistFixPanel'
import { _resetCsrfTokenForTests } from '@/utils/api'

const HOST = 'tfs.contoso.local'

// apiCall injects CSRF itself (fetching /api/auth/csrf-token first), so the
// first call any test sees through fetchMock is this token probe.
const CSRF_RESPONSE = { ok: true, status: 200, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ token: 'csrf-test-token' }) }

let fetchMock
const writeTextMock = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    _resetCsrfTokenForTests()
    // happy-dom may expose navigator.clipboard as a non-configurable getter,
    // so stub a fresh navigator-shaped object scoped to this test only.
    // `onLine` must be set explicitly: it's a getter on the real Navigator
    // prototype, not an own enumerable property, so the spread below drops
    // it — leaving it `undefined` reads as "offline" to apiCall's transport,
    // which queues mutations instead of sending them.
    writeTextMock.mockClear()
    vi.stubGlobal('navigator', {
        ...globalThis.navigator,
        onLine: true,
        clipboard: { writeText: writeTextMock },
    })
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('AllowlistFixPanel — admin vs non-admin branches', () => {
    it('canEdit=true renders the admin 1-click fix with an "Add <host>" button', () => {
        render(<AllowlistFixPanel host={HOST} canEdit={true} />)

        expect(
            screen.getByRole('button', { name: new RegExp(`add ${HOST.replace(/\./g, '\\.')}`, 'i') })
        ).toBeInTheDocument()
        expect(screen.getByText(/fixable in 1 click/i)).toBeInTheDocument()
        expect(screen.queryByText(/you need an admin/i)).not.toBeInTheDocument()
    })

    it('canEdit=false renders the non-admin guidance with host in a code block and a copy button', () => {
        render(<AllowlistFixPanel host={HOST} canEdit={false} />)

        expect(screen.getByText(/you need an admin/i)).toBeInTheDocument()
        // Host appears as a <code> block (intro paragraph + share-with-admin block)
        const codeBlocks = screen.getAllByText(HOST, { selector: 'code' })
        expect(codeBlocks.length).toBeGreaterThanOrEqual(1)
        expect(screen.getByRole('button', { name: /copy host/i })).toBeInTheDocument()
        // No admin quick-fix button in this branch
        expect(screen.queryByRole('button', { name: /add tfs/i })).not.toBeInTheDocument()
    })
})

describe('AllowlistFixPanel — .env line merge logic', () => {
    it('usingDefault=true keeps the default hosts and appends the new host', () => {
        render(<AllowlistFixPanel host={HOST} canEdit={false} usingDefault={true} />)

        expect(
            screen.getByText(`ALLOWED_AZURE_HOSTS=dev.azure.com,*.visualstudio.com,${HOST}`)
        ).toBeInTheDocument()
    })

    it('usingDefault=false merges the current patterns with the new host', () => {
        render(
            <AllowlistFixPanel
                host={HOST}
                canEdit={false}
                usingDefault={false}
                currentPatterns={['a.com', 'b.com']}
            />
        )

        expect(screen.getByText(`ALLOWED_AZURE_HOSTS=a.com,b.com,${HOST}`)).toBeInTheDocument()
    })

    it('does not duplicate the host when it is already in the current patterns', () => {
        render(
            <AllowlistFixPanel
                host={HOST}
                canEdit={false}
                usingDefault={false}
                currentPatterns={['a.com', HOST]}
            />
        )

        expect(screen.getByText(`ALLOWED_AZURE_HOSTS=a.com,${HOST}`)).toBeInTheDocument()
    })
})

describe('AllowlistFixPanel — admin add flow', () => {
    it('POSTs the host to /api/azure/host-allowlist, shows the success state, and calls onAdded', async () => {
        fetchMock
            .mockResolvedValueOnce(CSRF_RESPONSE)
            .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: () => Promise.resolve({}) })
        const onAdded = vi.fn()

        render(
            <AllowlistFixPanel
                host={HOST}
                canEdit={true}
                notes="from the wizard"
                onAdded={onAdded}
            />
        )

        const addBtn = screen.getByRole('button', { name: new RegExp(`add ${HOST.replace(/\./g, '\\.')}`, 'i') })
        await act(async () => { fireEvent.click(addBtn) })


        await waitFor(() => {
            expect(screen.getByRole('status')).toHaveTextContent(`${HOST} was added to the allowlist`)
        })

        expect(fetchMock).toHaveBeenCalledTimes(2)
        const [url, options] = fetchMock.mock.calls[1]
        expect(url).toBe('/api/azure/host-allowlist')
        expect(options.method).toBe('POST')
        expect(JSON.parse(options.body)).toEqual({ pattern: HOST, notes: 'from the wizard' })

        expect(onAdded).toHaveBeenCalledWith(HOST)
    })

    it('shows an inline role="alert" error and does not call onAdded when the POST fails', async () => {
        fetchMock
            .mockResolvedValueOnce(CSRF_RESPONSE)
            .mockResolvedValueOnce({
                ok: false,
                status: 400,
                json: () => Promise.resolve({ error: 'boom' }),
            })
        const onAdded = vi.fn()

        render(<AllowlistFixPanel host={HOST} canEdit={true} onAdded={onAdded} />)

        const addBtn = screen.getByRole('button', { name: new RegExp(`add ${HOST.replace(/\./g, '\\.')}`, 'i') })
        await act(async () => { fireEvent.click(addBtn) })

        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent('boom')
        })

        expect(onAdded).not.toHaveBeenCalled()
        // Panel did not flip to the success state
        expect(screen.queryByText(/was added to the allowlist/i)).not.toBeInTheDocument()
    })
})

describe('AllowlistFixPanel — non-admin copy host', () => {
    it('writes the host to the clipboard and flips the label to "copied"', async () => {
        render(<AllowlistFixPanel host={HOST} canEdit={false} />)

        const copyBtn = screen.getByRole('button', { name: /copy host/i })
        await act(async () => { fireEvent.click(copyBtn) })

        expect(writeTextMock).toHaveBeenCalledWith(HOST)
        await waitFor(() => {
            expect(screen.getByText(/^copied$/i)).toBeInTheDocument()
        })
    })
})
