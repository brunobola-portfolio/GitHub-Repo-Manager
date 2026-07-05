import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SelectionSheet } from '../../../src/components/RepoList/SelectionSheet'

// Stub framer-motion + the hooks used by Drawer to avoid jsdom flakiness.
const stripMotionProps = (props) => {
	const filtered = { ...props }
	for (const key of [
		'initial', 'animate', 'exit', 'transition', 'variants',
		'whileHover', 'whileTap', 'drag', 'dragConstraints', 'dragElastic', 'onDragEnd',
	]) delete filtered[key]
	return filtered
}
vi.mock('framer-motion', () => ({
	motion: {
		div: ({ children, ...props }) => <div {...stripMotionProps(props)}>{children}</div>,
		aside: ({ children, ...props }) => <aside {...stripMotionProps(props)}>{children}</aside>,
	},
	AnimatePresence: ({ children }) => <>{children}</>,
	useReducedMotion: () => false,
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

	it('renders all 9 batch action labels when open', () => {
		render(<SelectionSheet isOpen repos={repos} onAction={() => { }} onClose={() => { }} />)
		expect(screen.getByText(/archive 2 repos/i)).toBeInTheDocument()
		expect(screen.getByText(/transfer 2 repos/i)).toBeInTheDocument()
		expect(screen.getByText(/migrate 2 repos/i)).toBeInTheDocument()
		expect(screen.getByText(/dry-run 2 repos/i)).toBeInTheDocument()
		expect(screen.getByText(/make 2 repos public/i)).toBeInTheDocument()
		expect(screen.getByText(/make 2 repos private/i)).toBeInTheDocument()
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
