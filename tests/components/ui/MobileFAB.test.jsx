import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Search } from 'lucide-react'

vi.mock('framer-motion', async (importOriginal) => {
	const actual = await importOriginal()
	return {
		...actual,
		motion: new Proxy(actual.motion, { get: (t, k) => t[k] ?? t.button }),
	}
})

vi.mock('@/hooks/useMobileBreakpoint', () => ({
	useMobileBreakpoint: vi.fn(),
}))
import { useMobileBreakpoint } from '@/hooks/useMobileBreakpoint'

const { MobileFAB } = await import('@/components/ui/MobileFAB')

describe('MobileFAB', () => {
	beforeEach(() => { useMobileBreakpoint.mockReset() })

	it('renders nothing on desktop', () => {
		useMobileBreakpoint.mockReturnValue(false)
		const { container } = render(<MobileFAB icon={Search} label="Search" onClick={() => { }} />)
		expect(container.firstChild).toBeNull()
	})

	it('renders an accessible button on mobile', () => {
		useMobileBreakpoint.mockReturnValue(true)
		render(<MobileFAB icon={Search} label="Search" onClick={() => { }} />)
		const btn = screen.getByRole('button', { name: /Search/i })
		expect(btn).toBeInTheDocument()
		expect(btn).toHaveAttribute('aria-label', 'Search')
	})

	it('clicking fires onClick once', () => {
		useMobileBreakpoint.mockReturnValue(true)
		const onClick = vi.fn()
		render(<MobileFAB icon={Search} label="Search" onClick={onClick} />)
		fireEvent.click(screen.getByRole('button'))
		expect(onClick).toHaveBeenCalledOnce()
	})

	it('shifts up when shiftAboveBottomBar is true', () => {
		useMobileBreakpoint.mockReturnValue(true)
		render(<MobileFAB icon={Search} label="Search" onClick={() => { }} shiftAboveBottomBar />)
		const btn = screen.getByRole('button')
		expect(btn.className).toMatch(/bottom-20/)
	})

	it('uses bottom-6 by default', () => {
		useMobileBreakpoint.mockReturnValue(true)
		render(<MobileFAB icon={Search} label="Search" onClick={() => { }} />)
		const btn = screen.getByRole('button')
		expect(btn.className).toMatch(/bottom-6/)
		expect(btn.className).not.toMatch(/bottom-20/)
	})
})
