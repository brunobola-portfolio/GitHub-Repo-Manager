import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SelectionBar } from '../../../src/components/RepoList/SelectionBar'

describe('SelectionBar (desktop pill)', () => {
	const repos = [
		{ id: 1, full_name: 'a/b' },
		{ id: 2, full_name: 'c/d' },
	]

	it('renders the count', () => {
		render(<SelectionBar repos={repos} onAction={() => { }} onClear={() => { }} />)
		expect(screen.getByText('2')).toBeInTheDocument()
	})

	it('renders the inline action buttons (Archive, Transfer, Migrate, Make Public, Make Private, Export, Delete)', () => {
		render(<SelectionBar repos={repos} onAction={() => { }} onClear={() => { }} />)
		// Each inline batch action has a button labeled by its registry label
		expect(screen.getByRole('button', { name: /archive 2 repos/i })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: /transfer 2 repos/i })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: /migrate 2 repos/i })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: /make 2 repos public/i })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: /make 2 repos private/i })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: /export 2 \(json\)/i })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: /delete 2 repos/i })).toBeInTheDocument()
	})

	it('Delete button has destructive styling', () => {
		render(<SelectionBar repos={repos} onAction={() => { }} onClear={() => { }} />)
		const del = screen.getByRole('button', { name: /delete 2 repos/i })
		expect(del.className).toMatch(/text-rose-/) // destructive is rose now, red retired (FE-05)
	})

	it('clicking Archive calls onAction with archive_selected', () => {
		const onAction = vi.fn()
		render(<SelectionBar repos={repos} onAction={onAction} onClear={() => { }} />)
		screen.getByRole('button', { name: /archive 2 repos/i }).click()
		expect(onAction).toHaveBeenCalledWith('archive_selected', repos)
	})

	it('renders nothing when repos is empty', () => {
		const { container } = render(<SelectionBar repos={[]} onAction={() => { }} onClear={() => { }} />)
		expect(container.firstChild).toBeNull()
	})

	it('calls onClear when clear button clicked', () => {
		const onClear = vi.fn()
		render(<SelectionBar repos={repos} onAction={() => { }} onClear={onClear} />)
		screen.getByRole('button', { name: /clear selection/i }).click()
		expect(onClear).toHaveBeenCalled()
	})

	// U16 (2026-09-04 panel): the nine icons in this bar carried only a
	// native title= — no visible text at any breakpoint. Every pill now
	// renders a short static label (hidden below md, shown at md+ via CSS)
	// alongside the icon, in addition to the full resolved copy already
	// covered by the aria-label assertions above.
	it('every pill carries a visible short-label span for md+', () => {
		render(<SelectionBar repos={repos} onAction={() => { }} onClear={() => { }} />)
		for (const short of ['Archive', 'Transfer', 'Migrate', 'Public', 'Private', 'Export', 'Delete', 'Clear']) {
			expect(screen.getByText(short)).toBeInTheDocument()
		}
	})
})
