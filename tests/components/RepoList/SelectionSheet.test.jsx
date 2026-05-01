import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SelectionSheet } from '../../../src/components/RepoList/SelectionSheet'

// Stub framer-motion + the hooks used by MobileDrawer to avoid jsdom flakiness.
vi.mock('framer-motion', () => ({
	motion: {
		div: ({ children, ...props }) => {
			const filtered = { ...props }
			delete filtered.initial
			delete filtered.animate
			delete filtered.exit
			delete filtered.transition
			delete filtered.whileHover
			delete filtered.whileTap
			return <div {...filtered}>{children}</div>
		},
	},
	AnimatePresence: ({ children }) => <>{children}</>,
}))

vi.mock('../../../src/hooks/useFocusTrap', () => ({
	useFocusTrap: () => null,
}))
vi.mock('../../../src/hooks/useBodyScrollLock', () => ({
	useBodyScrollLock: () => { },
}))

describe('SelectionSheet (mobile bottom-sheet)', () => {
	const repos = [
		{ id: 1, full_name: 'a/b' },
		{ id: 2, full_name: 'c/d' },
	]

	it('renders all 8 batch action labels when open', () => {
		render(<SelectionSheet isOpen repos={repos} onAction={() => { }} onClose={() => { }} />)
		expect(screen.getByText(/archive 2 repos/i)).toBeInTheDocument()
		expect(screen.getByText(/transfer 2 repos/i)).toBeInTheDocument()
		expect(screen.getByText(/migrate 2 repos/i)).toBeInTheDocument()
		expect(screen.getByText(/dry-run 2 repos/i)).toBeInTheDocument()
		expect(screen.getByText(/make public\/private/i)).toBeInTheDocument()
		expect(screen.getByText(/export 2/i)).toBeInTheDocument()
		expect(screen.getByText(/batch index 2 with ai/i)).toBeInTheDocument()
		expect(screen.getByText(/delete 2 repos/i)).toBeInTheDocument()
	})

	it('renders nothing when repos is empty', () => {
		const { container } = render(<SelectionSheet isOpen repos={[]} onAction={() => { }} onClose={() => { }} />)
		expect(container.firstChild).toBeNull()
	})

	it('clicking an action calls onAction with the action ID and repos', () => {
		const onAction = vi.fn()
		render(<SelectionSheet isOpen repos={repos} onAction={onAction} onClose={() => { }} />)
		const archiveRow = screen.getByText(/archive 2 repos/i).closest('button')
		archiveRow?.click()
		expect(onAction).toHaveBeenCalledWith('archive_selected', repos)
	})
})
