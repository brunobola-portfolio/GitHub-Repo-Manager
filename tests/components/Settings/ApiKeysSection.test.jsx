/*
 * Chrome uniformity (audit task 11a): ApiKeysSection hand-rolled its header
 * (icon + h2 + p) instead of the canonical PanelHeader primitive used by
 * AIConfig/AIInstructions/WorkBoard. This locks in the PanelHeader-backed
 * header while keeping the section's title/description/action intact.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ApiKeysSection } from '@/components/Settings/ApiKeysSection'

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ keys: [], limits: null }),
    }))
})

afterEach(() => vi.unstubAllGlobals())

describe('ApiKeysSection — header uses PanelHeader', () => {
    it('renders title/description via PanelHeader and preserves the action button', async () => {
        render(<ApiKeysSection />)

        // findByRole (vs. getByRole) lets RTL's act-wrapped polling absorb the
        // mocked fetch's async state update, keeping output warning-free.
        const heading = await screen.findByRole('heading', { level: 2, name: 'API Keys' })
        // ds-font-display is PanelHeader's own h2 marker — proves the shared
        // primitive rendered it, not a hand-rolled <h2 className="text-base...">.
        expect(heading.className).toContain('ds-font-display')

        expect(screen.getByText('Manage programmatic access to the API')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /create new key/i })).toBeInTheDocument()
    })
})
