/*
 * Chrome uniformity (audit task 11a): AuditLogSection hand-rolled its header
 * instead of the canonical PanelHeader primitive. Locks in the standardized
 * header while preserving title/description.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AuditLogSection } from '@/components/Settings/AuditLogSection'

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ entries: [], total: 0 }),
    }))
})

afterEach(() => vi.unstubAllGlobals())

describe('AuditLogSection — header uses PanelHeader', () => {
    it('renders title/description via PanelHeader', async () => {
        render(<AuditLogSection />)

        // findByRole (vs. getByRole) lets RTL's act-wrapped polling absorb the
        // mocked fetch's async state update, keeping output warning-free.
        const heading = await screen.findByRole('heading', { level: 2, name: 'Audit Log' })
        expect(heading.className).toContain('ds-font-display')
        expect(screen.getByText('Track all account activity and changes')).toBeInTheDocument()
    })
})
