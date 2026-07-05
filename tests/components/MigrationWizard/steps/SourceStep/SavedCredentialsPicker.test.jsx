import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import SavedCredentialsPicker from '@/components/MigrationWizard/steps/SourceStep/SavedCredentialsPicker'

const CREDS_RESPONSE = {
    ok: true,
    json: async () => ({
        items: [
            { id: 'c1', label: 'Prod token', org: 'acme', prefix: 'ghp_aaa', lastUsedAt: null },
            { id: 'c2', label: 'Personal token', org: null, prefix: 'ghp_bbb', lastUsedAt: null },
        ],
    }),
}

/**
 * Smoke coverage for the post-Loader2→Spinner migration. We don't need to
 * re-verify the underlying fetch dance — that's tested by the Azure import
 * suite — just that the new <Spinner /> renders during the loading window
 * and that the loading row is wrapped in an aria-live region so screen
 * readers announce the transition.
 */
describe('<SavedCredentialsPicker />', () => {
    let originalFetch
    beforeEach(() => {
        originalFetch = global.fetch
    })
    afterEach(() => {
        global.fetch = originalFetch
        cleanup()
    })

    it('renders the Spinner with an aria-live wrapper while loading', () => {
        // Hold the response open so the loading branch stays mounted.
        global.fetch = vi.fn(() => new Promise(() => {}))
        render(
            <SavedCredentialsPicker
                host="dev.azure.com"
                org="acme"
                value={null}
                onPick={() => {}}
                onOpenSettings={() => {}}
            />
        )

        // The Spinner carries role="status" via the shared primitive.
        const spinner = screen.getByRole('status', { name: /loading credentials/i })
        expect(spinner).toBeInTheDocument()

        // The loading row's container must announce updates politely so SR
        // users hear the state change without stealing focus.
        const announcer = spinner.closest('[aria-live]')
        expect(announcer).not.toBeNull()
        expect(announcer.getAttribute('aria-live')).toBe('polite')
        expect(announcer.getAttribute('aria-atomic')).toBe('true')
    })

    it('does not render when host is empty (early-return contract)', () => {
        global.fetch = vi.fn()
        const { container } = render(
            <SavedCredentialsPicker host="" org="acme" value={null} onPick={() => {}} onOpenSettings={() => {}} />
        )
        // Empty host → returns null → nothing in the tree, fetch never fires.
        expect(container).toBeEmptyDOMElement()
        expect(global.fetch).not.toHaveBeenCalled()
    })

    it('does not render when the fetch resolves to zero credentials', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ items: [] }),
        })
        const { container } = render(
            <SavedCredentialsPicker host="dev.azure.com" org="acme" value={null} onPick={() => {}} onOpenSettings={() => {}} />
        )
        await waitFor(() => {
            expect(container).toBeEmptyDOMElement()
        })
    })

    // --- Post-migration onto ui/Select ---

    it('renders a Select combobox once credentials load', async () => {
        global.fetch = vi.fn().mockResolvedValue(CREDS_RESPONSE)
        render(
            <SavedCredentialsPicker host="dev.azure.com" org="acme" value={null} onPick={() => {}} onOpenSettings={() => {}} />
        )
        expect(await screen.findByRole('combobox', { name: /saved token/i })).toBeInTheDocument()
    })

    it('opens and lists saved tokens plus a paste-new row', async () => {
        global.fetch = vi.fn().mockResolvedValue(CREDS_RESPONSE)
        render(
            <SavedCredentialsPicker host="dev.azure.com" org="acme" value={null} onPick={() => {}} onOpenSettings={() => {}} />
        )
        const combo = await screen.findByRole('combobox', { name: /saved token/i })
        fireEvent.click(combo)
        expect(screen.getByRole('option', { name: /Prod token/ })).toBeInTheDocument()
        expect(screen.getByRole('option', { name: /Personal token/ })).toBeInTheDocument()
        expect(screen.getByRole('option', { name: /Paste a different PAT/ })).toBeInTheDocument()
    })

    it('flags the exact-org match on the matching row', async () => {
        global.fetch = vi.fn().mockResolvedValue(CREDS_RESPONSE)
        render(
            <SavedCredentialsPicker host="dev.azure.com" org="acme" value={null} onPick={() => {}} onOpenSettings={() => {}} />
        )
        const combo = await screen.findByRole('combobox', { name: /saved token/i })
        fireEvent.click(combo)
        // 'Prod token' is org=acme → exact match; 'Personal token' (org null) is not.
        expect(screen.getByRole('option', { name: /Prod token/ })).toHaveTextContent(/exact match/i)
        expect(screen.getByRole('option', { name: /Personal token/ })).not.toHaveTextContent(/exact match/i)
    })

    it('selecting a saved token calls onPick with its id', async () => {
        const onPick = vi.fn()
        global.fetch = vi.fn().mockResolvedValue(CREDS_RESPONSE)
        render(
            <SavedCredentialsPicker host="dev.azure.com" org="acme" value={null} onPick={onPick} onOpenSettings={() => {}} />
        )
        const combo = await screen.findByRole('combobox', { name: /saved token/i })
        fireEvent.click(combo)
        fireEvent.click(screen.getByRole('option', { name: /Personal token/ }))
        expect(onPick).toHaveBeenCalledWith('c2')
    })

    it('choosing "paste a different PAT" clears the pick via onPick(null)', async () => {
        const onPick = vi.fn()
        global.fetch = vi.fn().mockResolvedValue(CREDS_RESPONSE)
        render(
            <SavedCredentialsPicker host="dev.azure.com" org="acme" value={null} onPick={onPick} onOpenSettings={() => {}} />
        )
        const combo = await screen.findByRole('combobox', { name: /saved token/i })
        fireEvent.click(combo)
        fireEvent.click(screen.getByRole('option', { name: /Paste a different PAT/ }))
        expect(onPick).toHaveBeenCalledWith(null)
    })

    it('opens with the keyboard (ArrowDown) and Escape closes', async () => {
        global.fetch = vi.fn().mockResolvedValue(CREDS_RESPONSE)
        render(
            <SavedCredentialsPicker host="dev.azure.com" org="acme" value={null} onPick={() => {}} onOpenSettings={() => {}} />
        )
        const combo = await screen.findByRole('combobox', { name: /saved token/i })
        fireEvent.keyDown(combo, { key: 'ArrowDown' })
        expect(combo).toHaveAttribute('aria-expanded', 'true')
        fireEvent.keyDown(combo, { key: 'Escape' })
        expect(combo).toHaveAttribute('aria-expanded', 'false')
    })
})
