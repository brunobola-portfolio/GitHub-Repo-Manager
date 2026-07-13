import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ToastProvider } from '@/contexts/ToastProvider'
import { useToast } from '@/hooks/useToast'
import { onAppEvent, APP_EVENTS } from '@/utils/appEvents'

// Renders the toast content produced by toast.errorFromException so the
// action button (ErrorToastContent) is actually in the DOM and clickable —
// exercising the same path ToastContainer/<Toast> uses in the real app.
function Harness() {
    const { toast, toasts } = useToast()
    return (
        <div>
            <button onClick={() => toast.errorFromException({ code: 'TIER_REQUIRED_PRO' })}>
                fire
            </button>
            {toasts.map((t) => <div key={t.id}>{t.content}</div>)}
        </div>
    )
}

/*
 * Regression coverage: the 'open-pricing' toast action (fired by the
 * TIER_REQUIRED_PRO / TIER_REQUIRED_ENTERPRISE / UPGRADE_REQUIRED /
 * GITHUB_PRO_REQUIRED error codes in src/utils/errors.js) used to mutate
 * `window.location.hash` directly to the bare '#pricing', which the router
 * (src/hooks/useAppRouter.js) silently ignores — a dead CTA on every
 * tier-required toast. It must instead navigate through the app event bus
 * (navigateToPricing / APP_EVENTS.NAVIGATE_PRICING), same as
 * QuotaUpgradeButton, so React state (and the URL) actually update.
 */
describe('ToastProvider — open-pricing toast action', () => {
    beforeEach(() => {
        window.location.hash = ''
    })

    it('routes the "See plans" action through the app event bus instead of mutating the hash directly', () => {
        const fn = vi.fn()
        const off = onAppEvent(APP_EVENTS.NAVIGATE_PRICING, fn)

        render(<ToastProvider><Harness /></ToastProvider>)
        fireEvent.click(screen.getByText('fire'))
        fireEvent.click(screen.getByRole('button', { name: 'See plans' }))

        expect(fn).toHaveBeenCalledTimes(1)
        expect(window.location.hash).not.toBe('#pricing')

        off()
    })
})
