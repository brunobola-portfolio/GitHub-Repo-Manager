import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { OfflineBanner } from '@/components/ui/OfflineBanner'

describe('OfflineBanner', () => {
    let originalOnLine

    beforeEach(() => {
        originalOnLine = navigator.onLine
    })

    afterEach(() => {
        Object.defineProperty(navigator, 'onLine', {
            writable: true,
            value: originalOnLine,
        })
    })

    it('is hidden when the browser reports online', () => {
        Object.defineProperty(navigator, 'onLine', { writable: true, value: true })
        render(<OfflineBanner />)
        expect(screen.queryByTestId('offline-banner')).toBeNull()
    })

    it('is visible when the browser reports offline', () => {
        Object.defineProperty(navigator, 'onLine', { writable: true, value: false })
        render(<OfflineBanner />)
        const banner = screen.getByTestId('offline-banner')
        expect(banner).toBeInTheDocument()
        expect(banner.textContent).toMatch(/offline/i)
    })

    it('appears when going offline after mount', () => {
        Object.defineProperty(navigator, 'onLine', { writable: true, value: true })
        render(<OfflineBanner />)
        expect(screen.queryByTestId('offline-banner')).toBeNull()

        act(() => {
            Object.defineProperty(navigator, 'onLine', { writable: true, value: false })
            window.dispatchEvent(new Event('offline'))
        })

        expect(screen.getByTestId('offline-banner')).toBeInTheDocument()
    })
})
