import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('framer-motion', async (importOriginal) => {
	const actual = await importOriginal()
	return {
		...actual,
		motion: new Proxy(actual.motion, { get: (t, k) => t[k] ?? t.div }),
		AnimatePresence: ({ children }) => children,
	}
})

vi.mock('@/hooks/useMobileBreakpoint', () => ({ useMobileBreakpoint: vi.fn() }))
vi.mock('@/hooks/useViewportSafeHeight', () => ({ useViewportSafeHeight: vi.fn(() => 800) }))
vi.mock('@/hooks/useFocusTrap', () => ({ useFocusTrap: () => null }))
vi.mock('@/hooks/useBodyScrollLock', () => ({ useBodyScrollLock: () => { } }))
vi.mock('@/hooks/useMobileKeyboardFix', () => ({ useMobileKeyboardFix: () => { } }))

import { useMobileBreakpoint } from '@/hooks/useMobileBreakpoint'
const { ModalSticky } = await import('@/components/ui/ModalSticky')

describe('ModalSticky', () => {
	beforeEach(() => useMobileBreakpoint.mockReset())

	it('renders the body and footer at >= md (no sticky styling)', () => {
		useMobileBreakpoint.mockReturnValue(false)
		render(
			<ModalSticky
				isOpen
				onClose={() => { }}
				title="t"
				footer={<button type="button">Save</button>}
			>
				<p>body</p>
			</ModalSticky>
		)
		expect(screen.getByText('body')).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
		// Desktop variant: footer should NOT have sticky-bottom class
		const footer = screen.getByTestId('modal-sticky-footer')
		expect(footer.className).not.toMatch(/\bsticky\b/)
	})

	it('applies sticky-bottom footer at < md', () => {
		useMobileBreakpoint.mockReturnValue(true)
		render(
			<ModalSticky
				isOpen
				onClose={() => { }}
				title="t"
				footer={<button type="button">Save</button>}
			>
				<p>body</p>
			</ModalSticky>
		)
		const footer = screen.getByTestId('modal-sticky-footer')
		expect(footer.className).toMatch(/\bsticky\b/)
		expect(footer.className).toMatch(/bottom-0/)
	})

	it('does not render the footer wrapper when no footer is supplied', () => {
		useMobileBreakpoint.mockReturnValue(true)
		render(
			<ModalSticky isOpen onClose={() => { }} title="t">
				<p>body</p>
			</ModalSticky>
		)
		expect(screen.queryByTestId('modal-sticky-footer')).toBeNull()
	})
})
