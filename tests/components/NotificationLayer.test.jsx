/*
 * Unit tests for NotificationLayer — the bottom-of-tree global overlay surfaces
 * extracted from App.jsx (toasts, pending-sync banner, welcome tour, the
 * quota-exceeded dialog, offline banner).
 *
 * The leaf surfaces are stubbed to prop-echoes so these assert NotificationLayer's
 * own composition + the quota-dialog logic it owns (the role=dialog wrapper,
 * backdrop/inner click handling, and the useFocusTrap-driven Escape close).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import { ToastProvider } from '@/contexts/ToastProvider'
import { useToast } from '@/hooks/useToast'

vi.mock('@/components/ui/PendingSyncBanner', () => ({
    PendingSyncBanner: ({ isAuthenticated }) => (
        <div data-testid="pending-sync" data-auth={String(isAuthenticated)} />
    ),
}))

vi.mock('@/components/Onboarding/OnboardingTour', () => ({
    OnboardingTour: ({ isOpen, onClose, onNeverShow }) =>
        isOpen ? (
            <div data-testid="onboarding-tour">
                <button onClick={onClose}>tour-close</button>
                <button onClick={onNeverShow}>tour-never</button>
            </div>
        ) : null,
}))

vi.mock('@/components/ui/OfflineBanner', () => ({
    OfflineBanner: () => <div data-testid="offline-banner" />,
}))

vi.mock('@/components/ui/QuotaExceededState', () => ({
    QuotaExceededState: ({ feature, currentTier, used, limit, onClose }) => (
        <div data-testid="quota-content" data-feature={feature} data-tier={currentTier} data-used={used} data-limit={limit}>
            <button onClick={onClose}>quota-content-close</button>
        </div>
    ),
}))

const { NotificationLayer } = await import('@/components/NotificationLayer')

let fireToast = null
function ToastHandle() {
    fireToast = useToast().toast
    return null
}

function renderLayer(props = {}) {
    const merged = {
        isAuthenticated: true,
        tourOpen: false,
        onCloseTour: vi.fn(),
        onNeverShowTour: vi.fn(),
        quotaModal: null,
        onCloseQuota: vi.fn(),
        ...props,
    }
    return {
        ...render(<NotificationLayer {...merged} />, {
            wrapper: ({ children }) => <ToastProvider><ToastHandle />{children}</ToastProvider>,
        }),
        props: merged,
    }
}

beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
})

describe('NotificationLayer', () => {
    it('always renders the pending-sync and offline banners', () => {
        renderLayer({ isAuthenticated: true })
        expect(screen.getByTestId('pending-sync')).toHaveAttribute('data-auth', 'true')
        expect(screen.getByTestId('offline-banner')).toBeInTheDocument()
    })

    it("draws the provider's toasts and dismisses them", async () => {
        renderLayer()
        act(() => { fireToast.info('Saved the preset') })
        expect(screen.getByText('Saved the preset')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
        await waitFor(() => expect(screen.queryByText('Saved the preset')).toBeNull())
    })

    it('renders the welcome tour only when open, and wires close / never-show', () => {
        const { rerender, props } = renderLayer({ tourOpen: false })
        expect(screen.queryByTestId('onboarding-tour')).toBeNull()
        rerender(
            <NotificationLayer
                isAuthenticated
                tourOpen onCloseTour={props.onCloseTour} onNeverShowTour={props.onNeverShowTour}
                quotaModal={null} onCloseQuota={vi.fn()}
            />
        )
        expect(screen.getByTestId('onboarding-tour')).toBeInTheDocument()
        fireEvent.click(screen.getByText('tour-close'))
        expect(props.onCloseTour).toHaveBeenCalledTimes(1)
        fireEvent.click(screen.getByText('tour-never'))
        expect(props.onNeverShowTour).toHaveBeenCalledTimes(1)
    })

    it('does not render the quota dialog when quotaModal is null', () => {
        renderLayer({ quotaModal: null })
        expect(screen.queryByRole('dialog', { name: /quota exceeded/i })).toBeNull()
    })

    it('renders the quota dialog with the modal fields when set', () => {
        renderLayer({ quotaModal: { feature: 'AI', tier: 'free', used: 100, limit: 100 } })
        const dialog = screen.getByRole('dialog', { name: /quota exceeded/i })
        expect(dialog).toBeInTheDocument()
        const content = screen.getByTestId('quota-content')
        expect(content).toHaveAttribute('data-feature', 'AI')
        expect(content).toHaveAttribute('data-tier', 'free')
        expect(content).toHaveAttribute('data-limit', '100')
    })

    it('closes the quota dialog on backdrop click but not on inner-card click', () => {
        const { props } = renderLayer({ quotaModal: { feature: 'AI' } })
        // Inner content click must not bubble to the backdrop close.
        fireEvent.click(screen.getByTestId('quota-content'))
        expect(props.onCloseQuota).not.toHaveBeenCalled()
        // Backdrop (the dialog element itself) closes.
        fireEvent.click(screen.getByRole('dialog', { name: /quota exceeded/i }))
        expect(props.onCloseQuota).toHaveBeenCalledTimes(1)
    })

    it('closes the quota dialog on Escape (focus trap)', () => {
        const { props } = renderLayer({ quotaModal: { feature: 'AI' } })
        fireEvent.keyDown(document, { key: 'Escape' })
        expect(props.onCloseQuota).toHaveBeenCalledTimes(1)
    })

    it('defaults the quota feature to AI when none is provided', () => {
        renderLayer({ quotaModal: {} })
        expect(screen.getByTestId('quota-content')).toHaveAttribute('data-feature', 'AI')
    })
})
