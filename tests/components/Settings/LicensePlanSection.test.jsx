/*
 * Chrome uniformity (audit task 11a): LicensePlanSection hand-rolled its
 * header instead of the canonical PanelHeader primitive. Locks in the
 * standardized header while preserving title/description.
 *
 * useModal() requires a ModalProvider ancestor (matches the pattern already
 * used by WorkBoardPage.test.jsx).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LicensePlanSection } from '@/components/Settings/LicensePlanSection'
import { ModalProvider } from '@/contexts/ModalContext'

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 501,
        json: async () => ({}),
    }))
})

afterEach(() => vi.unstubAllGlobals())

describe('LicensePlanSection — header uses PanelHeader', () => {
    it('renders title/description via PanelHeader', async () => {
        render(
            <ModalProvider>
                <LicensePlanSection />
            </ModalProvider>
        )

        // findByRole (vs. getByRole) lets RTL's act-wrapped polling absorb the
        // mocked fetch's async state update, keeping output warning-free.
        const heading = await screen.findByRole('heading', { level: 2, name: 'License & Plan' })
        expect(heading.className).toContain('ds-font-display')
        expect(screen.getByText('Manage your license, plan and usage')).toBeInTheDocument()
    })
})
