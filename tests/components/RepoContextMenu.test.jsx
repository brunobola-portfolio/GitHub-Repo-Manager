import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import RepoContextMenu from '../../src/components/RepoContextMenu'
import { repoActions } from '../../src/actions/repoActions'

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

const repo = {
	id: 1,
	name: 'demo',
	full_name: 'me/demo',
	owner: { login: 'me' },
	html_url: 'https://github.com/me/demo',
	clone_url: 'https://github.com/me/demo.git',
	ssh_url: 'git@github.com:me/demo.git',
	private: false,
	archived: false,
	isMirror: false,
}

describe('RepoContextMenu — registry parity', () => {
	it('top-level rendered IDs are a subset of the registry contextMenu set', () => {
		render(<RepoContextMenu repo={repo} x={0} y={0} onClose={() => { }} onAction={() => { }} />)

		const renderedTop = Array.from(document.body.querySelectorAll('[role="menuitem"][data-testid^="menu-item-"]'))
			.map((el) => el.getAttribute('data-testid').replace('menu-item-', ''))

		const registrySet = new Set(
			Object.values(repoActions)
				.filter((a) => a.surfaces.includes('contextMenu') && !a.isBatchSafe)
				.map((a) => a.id)
		)

		// Every directly-rendered ID exists in the registry
		for (const id of renderedTop) {
			expect(registrySet.has(id), `${id} rendered but not in registry`).toBe(true)
		}

		// The top-level menu surfaces these flat (others nest in submenus)
		const directIds = ['open_detail', 'open_repo_settings', 'open_on_github', 'visibility', 'archive', 'delete']
		for (const id of directIds) {
			expect(renderedTop, `${id} should be visible at top level`).toContain(id)
		}
	})
})
