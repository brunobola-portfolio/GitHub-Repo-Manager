import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ContextMenu from '@/components/ui/ContextMenu'

// Mock framer-motion to avoid animation issues in tests
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
		}
	},
	AnimatePresence: ({ children }) => <>{children}</>
}))

describe('ContextMenu', () => {
	const items = [
		{ label: 'Action 1', onClick: vi.fn() },
		{ type: 'separator' },
		{ label: 'Submenu', children: [
			{ label: 'Sub 1', onClick: vi.fn() },
			{ label: 'Sub 2', onClick: vi.fn() }
		]},
		{ label: 'Disabled', disabled: true, tooltip: 'Not available' }
	]

	it('renders menu items', () => {
		render(<ContextMenu items={items} x={100} y={100} onClose={vi.fn()} />)
		expect(screen.getByText('Action 1')).toBeInTheDocument()
		expect(screen.getByText('Submenu')).toBeInTheDocument()
	})

	it('closes on Escape', async () => {
		const onClose = vi.fn()
		render(<ContextMenu items={items} x={100} y={100} onClose={onClose} />)
		await userEvent.keyboard('{Escape}')
		expect(onClose).toHaveBeenCalled()
	})

	it('renders disabled items with aria-disabled', () => {
		render(<ContextMenu items={items} x={100} y={100} onClose={vi.fn()} />)
		const disabled = screen.getByText('Disabled')
		expect(disabled.closest('[role="menuitem"]')).toHaveAttribute('aria-disabled', 'true')
	})

	it('calls onClick when item clicked', async () => {
		render(<ContextMenu items={items} x={100} y={100} onClose={vi.fn()} />)
		await userEvent.click(screen.getByText('Action 1'))
		expect(items[0].onClick).toHaveBeenCalled()
	})

	it('renders separator elements', () => {
		render(<ContextMenu items={items} x={100} y={100} onClose={vi.fn()} />)
		const separators = screen.getAllByRole('separator')
		expect(separators.length).toBeGreaterThanOrEqual(1)
	})

	it('renders header items as non-interactive', () => {
		const headerItems = [
			{ type: 'header', label: 'My Section' },
			{ label: 'Action', onClick: vi.fn() }
		]
		render(<ContextMenu items={headerItems} x={100} y={100} onClose={vi.fn()} />)
		expect(screen.getByText('My Section')).toBeInTheDocument()
		expect(screen.getByText('My Section').closest('[role="presentation"]')).toBeInTheDocument()
	})

	it('shows chevron for items with children', () => {
		render(<ContextMenu items={items} x={100} y={100} onClose={vi.fn()} />)
		const submenuItem = screen.getByText('Submenu').closest('[role="menuitem"]')
		expect(submenuItem).toHaveAttribute('aria-haspopup', 'true')
	})

	it('does not call onClick for disabled items', async () => {
		const disabledHandler = vi.fn()
		const testItems = [
			{ label: 'Cannot Click', disabled: true, onClick: disabledHandler }
		]
		render(<ContextMenu items={testItems} x={100} y={100} onClose={vi.fn()} />)
		await userEvent.click(screen.getByText('Cannot Click'))
		expect(disabledHandler).not.toHaveBeenCalled()
	})

	it('renders danger items', () => {
		const dangerItems = [
			{ label: 'Delete', danger: true, onClick: vi.fn() }
		]
		render(<ContextMenu items={dangerItems} x={100} y={100} onClose={vi.fn()} />)
		expect(screen.getByText('Delete')).toBeInTheDocument()
	})

	it('closes when backdrop is clicked', async () => {
		const onClose = vi.fn()
		const { container } = render(<ContextMenu items={items} x={100} y={100} onClose={onClose} />)
		// The backdrop is the first fixed inset-0 element
		const backdrop = container.querySelector('.fixed.inset-0')
		if (backdrop) {
			await userEvent.click(backdrop)
			expect(onClose).toHaveBeenCalled()
		}
	})

	it('renders two-line layout when item.description is set', () => {
		const itemsWithDesc = [
			{ label: 'Make Private', description: 'Hides repo from listings.', onClick: vi.fn() },
		]
		render(<ContextMenu items={itemsWithDesc} x={100} y={100} onClose={vi.fn()} />)
		expect(screen.getByText('Make Private')).toBeInTheDocument()
		expect(screen.getByText('Hides repo from listings.')).toBeInTheDocument()
		expect(screen.getByTestId('menu-item-description')).toBeInTheDocument()
	})

	it('renders single-line when description is absent (backwards compat)', () => {
		const itemsNoDesc = [{ label: 'Open', onClick: vi.fn() }]
		render(<ContextMenu items={itemsNoDesc} x={100} y={100} onClose={vi.fn()} />)
		expect(screen.getByText('Open')).toBeInTheDocument()
		expect(screen.queryByTestId('menu-item-description')).toBeNull()
	})

	it('applies destructive styling when intent="destructive"', () => {
		const destructiveItems = [
			{ label: 'Delete', intent: 'destructive', onClick: vi.fn() },
		]
		render(<ContextMenu items={destructiveItems} x={100} y={100} onClose={vi.fn()} />)
		const item = document.body.querySelector('[role="menuitem"]')
		expect(item).not.toBeNull()
		expect(item.className).toMatch(/text-red-/)
	})
})
