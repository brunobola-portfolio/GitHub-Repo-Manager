/*
 * MigrationActivity dashboard widget (prod-premium readiness — UX medium).
 *
 * Previously a fetch failure was swallowed and rendered the *same* "No
 * migrations yet" empty state as a genuinely-empty account, and neither state
 * had a CTA. These tests pin the fix: errors render a distinct "Couldn't load
 * migrations" state with Retry; the genuinely-empty state offers a CTA that
 * opens the Migration Wizard.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

const { openModal } = vi.hoisted(() => ({ openModal: vi.fn() }))
vi.mock('@/hooks/useModal', () => ({ useModal: () => ({ openModal }) }))

import { MigrationActivity } from '@/components/Dashboard/MigrationActivity'

const okJson = (data) => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => data })
const emptyStats = { total: 0, completed: 0, running: 0, failed: 0, tfvc: 0, recent: [] }

let originalFetch
beforeEach(() => {
    originalFetch = global.fetch
    vi.clearAllMocks()
    // .env.test sets VITE_MOCK_MODE=true, which activates the widget's demo-data
    // branch. Disable it so these tests exercise the real fetch/error/empty paths.
    vi.stubEnv('VITE_MOCK_MODE', 'false')
})
afterEach(() => {
    global.fetch = originalFetch
    vi.unstubAllEnvs()
    cleanup()
})

describe('MigrationActivity', () => {
    it('renders a distinct error state with Retry when the stats request fails', async () => {
        global.fetch = vi.fn().mockRejectedValueOnce(new Error('network'))
        render(<MigrationActivity />)
        expect(await screen.findByText(/couldn't load migrations/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
        // Not masquerading as the empty state.
        expect(screen.queryByText(/no migrations yet/i)).not.toBeInTheDocument()
    })

    it('treats a non-ok response as an error, not as empty', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
        render(<MigrationActivity />)
        expect(await screen.findByText(/couldn't load migrations/i)).toBeInTheDocument()
    })

    it('Retry re-fetches and renders stats on success', async () => {
        global.fetch = vi.fn()
            .mockRejectedValueOnce(new Error('network'))
            .mockResolvedValueOnce(okJson({ ...emptyStats, total: 2, completed: 2 }))
        render(<MigrationActivity />)
        fireEvent.click(await screen.findByRole('button', { name: /retry/i }))
        await waitFor(() => expect(screen.getByText(/total imports/i)).toBeInTheDocument())
        expect(global.fetch).toHaveBeenCalledTimes(2)
    })

    it('empty state offers a CTA that opens the Migration Wizard', async () => {
        global.fetch = vi.fn().mockResolvedValue(okJson(emptyStats))
        render(<MigrationActivity />)
        const cta = await screen.findByRole('button', { name: /start a migration/i })
        fireEvent.click(cta)
        expect(openModal).toHaveBeenCalledWith('showMigrationWizard')
    })

    it('renders recent migrations when stats are present', async () => {
        global.fetch = vi.fn().mockResolvedValue(okJson({
            ...emptyStats,
            total: 1,
            completed: 1,
            recent: [{
                id: 'j1',
                sourceName: 'acme/thing',
                targetFullName: 'me/thing',
                status: 'complete',
                sourceType: 'github',
                startedAt: new Date().toISOString(),
                completedAt: new Date().toISOString(),
            }],
        }))
        render(<MigrationActivity />)
        expect(await screen.findByText('acme/thing')).toBeInTheDocument()
    })
})
