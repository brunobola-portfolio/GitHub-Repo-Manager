import { describe, it, expect } from 'vitest'
import { repoActions } from '../../src/actions/repoActions'

const VALID_INTENTS = ['navigation', 'copy', 'mutation', 'destructive', 'read-only']
const VALID_SURFACES = ['contextMenu', 'quickAction', 'selectionBar', 'commandPalette']

describe('repoActions registry', () => {
	it('exports an object', () => {
		expect(typeof repoActions).toBe('object')
		expect(repoActions).not.toBeNull()
	})

	it('every action has required fields', () => {
		for (const [id, action] of Object.entries(repoActions)) {
			expect(action.id, `id field for ${id}`).toBe(id)
			expect(action.label, `label for ${id}`).toBeDefined()
			expect(action.icon, `icon for ${id}`).toBeDefined()
			expect(VALID_INTENTS, `intent for ${id}`).toContain(action.intent)
			expect(Array.isArray(action.surfaces), `surfaces for ${id}`).toBe(true)
			expect(action.surfaces.length, `surfaces for ${id}`).toBeGreaterThan(0)
			action.surfaces.forEach((s) => {
				expect(VALID_SURFACES, `surface ${s} on ${id}`).toContain(s)
			})
			expect(typeof action.run, `run() for ${id}`).toBe('function')
		}
	})

	it('all IDs are snake_case', () => {
		for (const id of Object.keys(repoActions)) {
			expect(id).toMatch(/^[a-z][a-z0-9_]*$/)
		}
	})

	it('IDs are unique', () => {
		const ids = Object.keys(repoActions)
		expect(new Set(ids).size).toBe(ids.length)
	})

	it('navigation and copy actions are present', () => {
		expect(repoActions.open_detail).toBeDefined()
		expect(repoActions.open_repo_settings).toBeDefined()
		expect(repoActions.open_on_github).toBeDefined()
		expect(repoActions.copy_clone_https).toBeDefined()
		expect(repoActions.copy_clone_ssh).toBeDefined()
		expect(repoActions.copy_clone_gh).toBeDefined()
		expect(repoActions.migration_history).toBeDefined()
		expect(repoActions.community_health).toBeDefined()
	})
})
