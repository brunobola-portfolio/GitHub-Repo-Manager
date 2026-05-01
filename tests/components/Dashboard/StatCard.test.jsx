import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Folder } from 'lucide-react'
import { StatCard } from '@/components/Dashboard/StatCard'

vi.mock('framer-motion', async (importOriginal) => {
	const actual = await importOriginal()
	return {
		...actual,
		motion: new Proxy(actual.motion, {
			get: (t, k) => t[k] ?? t.div,
		}),
	}
})

describe('Dashboard StatCard — interactive variant', () => {
	it('renders non-interactive when onClick is not provided (no role=button)', () => {
		const { container } = render(<StatCard title="Total" value={42} icon={Folder} />)
		// No outer role=button
		expect(container.querySelector('[role="button"]')).toBeNull()
		// Hint not shown either
		expect(screen.queryByText(/View all/i)).toBeNull()
	})

	it('renders as a button when onClick is provided', () => {
		render(<StatCard title="Total" value={42} icon={Folder} onClick={() => { }} hint="View all repositories" />)
		const btn = screen.getByRole('button', { name: /Total — View all repositories/i })
		expect(btn).toBeInTheDocument()
		expect(btn).toHaveAttribute('tabindex', '0')
	})

	it('clicking calls onClick', () => {
		const onClick = vi.fn()
		render(<StatCard title="Total" value={42} icon={Folder} onClick={onClick} hint="View all" />)
		fireEvent.click(screen.getByRole('button'))
		expect(onClick).toHaveBeenCalledTimes(1)
	})

	it('Enter and Space keys activate the card', () => {
		const onClick = vi.fn()
		render(<StatCard title="Total" value={42} icon={Folder} onClick={onClick} hint="View all" />)
		const btn = screen.getByRole('button')
		fireEvent.keyDown(btn, { key: 'Enter' })
		fireEvent.keyDown(btn, { key: ' ' })
		expect(onClick).toHaveBeenCalledTimes(2)
	})

	it('hint text is rendered below the value (visible on hover)', () => {
		render(<StatCard title="Total" value={42} icon={Folder} onClick={() => { }} hint="View all repositories" />)
		expect(screen.getByText('View all repositories')).toBeInTheDocument()
	})

	it('shows skeleton when loading regardless of onClick', () => {
		const { container } = render(<StatCard title="Total" value={42} icon={Folder} loading onClick={() => { }} />)
		expect(container.querySelector('[role="button"]')).toBeNull()
	})

	it('does not bubble click for non-interactive cards (no onClick wired)', () => {
		const { container } = render(<StatCard title="Total" value={42} icon={Folder} />)
		// Outer wrapper has no onClick attached. Smoke check that clicking does not throw.
		fireEvent.click(container.firstChild)
	})
})
