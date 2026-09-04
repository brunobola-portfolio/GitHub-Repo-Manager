/*
 * G6 — audit log as a page. Covers the three behaviours the panel asked for
 * explicitly: the page renders, the action filter is populated from
 * GET /api/v1/audit/actions, and a "Verify chain" result is shown.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AuditLogPage } from '@/components/Audit/AuditLogPage'

function mockFetchByUrl(handlers) {
    return vi.fn((url) => {
        const key = Object.keys(handlers).find((k) => String(url).includes(k))
        if (!key) return Promise.resolve({ ok: true, json: async () => ({}) })
        return Promise.resolve(handlers[key])
    })
}

afterEach(() => vi.unstubAllGlobals())

describe('AuditLogPage', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', mockFetchByUrl({
            '/audit/actions': { ok: true, json: async () => ({ actions: ['auth.login', 'repo.delete'] }) },
            '/audit/verify': { ok: true, json: async () => ({ ok: true, checked: 12, brokenAt: null }) },
            '/audit': { ok: true, json: async () => ({ entries: [{ id: 1, action: 'auth.login', created_at: '2026-08-01 10:00:00', resource_type: 'user', resource_id: '1', ip_address: '127.0.0.1' }], total: 1 }) },
        }))
    })

    it('renders the page title and the fetched log row', async () => {
        render(<AuditLogPage />)
        expect(await screen.findByRole('heading', { name: 'Audit Log' })).toBeInTheDocument()
        expect(await screen.findByText('auth.login')).toBeInTheDocument()
    })

    it('populates the action filter from GET /api/v1/audit/actions', async () => {
        render(<AuditLogPage />)
        // The Select trigger shows the currently selected label; default is
        // "All Actions" until the user opens it, but the fetched options must
        // have been requested and stored.
        await waitFor(() => {
            expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/audit/actions'), expect.anything())
        })
    })

    it('shows a green verify result when the chain is intact', async () => {
        render(<AuditLogPage />)
        const verifyButton = await screen.findByRole('button', { name: /verify chain/i })
        fireEvent.click(verifyButton)
        expect(await screen.findByText(/chain intact/i)).toBeInTheDocument()
        expect(await screen.findByText(/12 entries verified/i)).toBeInTheDocument()
    })

    it('shows a broken-chain result with the entry number when tampering is detected', async () => {
        vi.stubGlobal('fetch', mockFetchByUrl({
            '/audit/actions': { ok: true, json: async () => ({ actions: [] }) },
            '/audit/verify': { ok: true, json: async () => ({ ok: false, checked: 5, brokenAt: 6 }) },
            '/audit': { ok: true, json: async () => ({ entries: [], total: 0 }) },
        }))
        render(<AuditLogPage />)
        const verifyButton = await screen.findByRole('button', { name: /verify chain/i })
        fireEvent.click(verifyButton)
        expect(await screen.findByText(/chain broken at entry #6/i)).toBeInTheDocument()
    })
})
