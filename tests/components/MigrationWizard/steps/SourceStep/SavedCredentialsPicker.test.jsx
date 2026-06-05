import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import SavedCredentialsPicker from '@/components/MigrationWizard/steps/SourceStep/SavedCredentialsPicker'

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
})
