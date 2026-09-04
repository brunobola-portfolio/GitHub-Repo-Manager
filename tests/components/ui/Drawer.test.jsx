import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Settings } from 'lucide-react'

// Mock useReducedMotion at module level so individual tests can flip it.
let __reducedMotion = false
vi.mock('framer-motion', async () => {
    const actual = await vi.importActual('framer-motion')
    return {
        ...actual,
        useReducedMotion: () => __reducedMotion,
    }
})

import { Drawer } from '../../../src/components/ui/Drawer'

describe('Drawer', () => {
    beforeEach(() => {
        __reducedMotion = false
    })

    it('renders children + title when open', () => {
        render(
            <Drawer isOpen onClose={() => {}} title="My Drawer">
                <p>Body content</p>
            </Drawer>,
        )
        expect(screen.getByText('Body content')).toBeInTheDocument()
        expect(screen.getByText('My Drawer')).toBeInTheDocument()
    })

    it('renders nothing when closed', () => {
        render(
            <Drawer isOpen={false} onClose={() => {}} title="Hidden">
                <p>hidden body</p>
            </Drawer>,
        )
        expect(screen.queryByText('hidden body')).not.toBeInTheDocument()
        expect(screen.queryByText('Hidden')).not.toBeInTheDocument()
    })

    it('positions itself correctly per side prop (data-side + position class)', () => {
        const { rerender } = render(
            <Drawer isOpen onClose={() => {}} side="left">
                <p>L</p>
            </Drawer>,
        )
        let panel = screen.getByTestId('drawer-panel')
        expect(panel.getAttribute('data-side')).toBe('left')
        expect(panel.className).toContain('left-0')

        rerender(
            <Drawer isOpen onClose={() => {}} side="right">
                <p>R</p>
            </Drawer>,
        )
        panel = screen.getByTestId('drawer-panel')
        expect(panel.getAttribute('data-side')).toBe('right')
        expect(panel.className).toContain('right-0')

        rerender(
            <Drawer isOpen onClose={() => {}} side="bottom">
                <p>B</p>
            </Drawer>,
        )
        panel = screen.getByTestId('drawer-panel')
        expect(panel.getAttribute('data-side')).toBe('bottom')
        // Bottom variant pins to bottom edge — this is the bug-fix assertion.
        expect(panel.className).toContain('bottom-0')
        expect(panel.className).toContain('rounded-t-2xl')
    })

    it('calls onClose when backdrop is clicked', () => {
        const onClose = vi.fn()
        render(
            <Drawer isOpen onClose={onClose} title="Tx">
                <p>body</p>
            </Drawer>,
        )
        fireEvent.click(screen.getByTestId('drawer-backdrop'))
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('calls onClose when the X close button is clicked', () => {
        const onClose = vi.fn()
        render(
            <Drawer isOpen onClose={onClose} title="Tx">
                <p>body</p>
            </Drawer>,
        )
        fireEvent.click(screen.getByRole('button', { name: /^close/i }))
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('calls onClose on Escape (focus trap engaged)', () => {
        const onClose = vi.fn()
        render(
            <Drawer isOpen onClose={onClose} title="Tx">
                <p>body</p>
            </Drawer>,
        )
        fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })
        expect(onClose).toHaveBeenCalled()
    })

    it('mobileOnly applies xl:hidden to backdrop and panel', () => {
        render(
            <Drawer isOpen onClose={() => {}} mobileOnly>
                <p>body</p>
            </Drawer>,
        )
        expect(screen.getByTestId('drawer-backdrop').className).toContain('xl:hidden')
        expect(screen.getByTestId('drawer-panel').className).toContain('xl:hidden')
    })

    it('does NOT apply xl:hidden when mobileOnly is false', () => {
        render(
            <Drawer isOpen onClose={() => {}}>
                <p>body</p>
            </Drawer>,
        )
        expect(screen.getByTestId('drawer-backdrop').className).not.toContain('xl:hidden')
    })

    it('hides the close button when showCloseButton=false', () => {
        render(
            <Drawer isOpen onClose={() => {}} title="No close" showCloseButton={false}>
                <p>body</p>
            </Drawer>,
        )
        expect(screen.queryByRole('button', { name: /^close/i })).not.toBeInTheDocument()
    })

    it('renders subtitle and icon when provided', () => {
        render(
            <Drawer isOpen onClose={() => {}} title="With Header" subtitle="A subtitle" icon={Settings}>
                <p>body</p>
            </Drawer>,
        )
        expect(screen.getByText('With Header')).toBeInTheDocument()
        expect(screen.getByText('A subtitle')).toBeInTheDocument()
    })

    it('renders the footer slot when provided', () => {
        render(
            <Drawer isOpen onClose={() => {}} title="Footer slot" footer={<button type="button">Apply</button>}>
                <p>body</p>
            </Drawer>,
        )
        expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument()
    })

    it('shows drag handle by default for side="bottom"', () => {
        const { container } = render(
            <Drawer isOpen onClose={() => {}} side="bottom">
                <p>body</p>
            </Drawer>,
        )
        // The drag handle is a small w-10 h-1 pill rendered above the header.
        const pill = container.querySelector('span.w-10.h-1.rounded-full')
        expect(pill).not.toBeNull()
    })

    it('does NOT show drag handle by default for side="right"', () => {
        const { container } = render(
            <Drawer isOpen onClose={() => {}} side="right">
                <p>body</p>
            </Drawer>,
        )
        const pill = container.querySelector('span.w-10.h-1.rounded-full')
        expect(pill).toBeNull()
    })

    it('respects reduced-motion preference', () => {
        __reducedMotion = true
        // Smoke test: simply confirms no crash + render works when reduced motion is on.
        render(
            <Drawer isOpen onClose={() => {}} title="Reduced">
                <p>body</p>
            </Drawer>,
        )
        expect(screen.getByText('Reduced')).toBeInTheDocument()
        expect(screen.getByText('body')).toBeInTheDocument()
    })
})
