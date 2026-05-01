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

describe('mutation actions', () => {
	it('visibility, archive, transfer, mirror, sync, ai_suggest_name_desc are present', () => {
		expect(repoActions.visibility).toBeDefined()
		expect(repoActions.archive).toBeDefined()
		expect(repoActions.transfer).toBeDefined()
		expect(repoActions.mirror).toBeDefined()
		expect(repoActions.sync).toBeDefined()
		expect(repoActions.ai_suggest_name_desc).toBeDefined()
	})

	it('non-wrapper mutation actions trigger refresh', () => {
		expect(repoActions.sync.triggersRefresh).toBe(true)
		expect(repoActions.transfer.triggersRefresh).toBe(true)
		expect(repoActions.mirror.triggersRefresh).toBe(true)
	})

	it('wrapper-bound mutations do NOT triggerRefresh (wrapper handles it)', () => {
		expect(repoActions.archive.triggersRefresh).toBeFalsy()
		expect(repoActions.visibility.triggersRefresh).toBeFalsy()
	})

	it('visibility confirm uses warning variant', () => {
		const cfg = repoActions.visibility.confirm({ name: 'r', private: false })
		expect(cfg).toBeTruthy()
		expect(cfg.variant).toBe('warning')
	})

	it('transfer confirm uses warning variant', () => {
		const cfg = repoActions.transfer.confirm({ name: 'r' })
		expect(cfg).toBeTruthy()
		expect(cfg.variant).toBe('warning')
	})

	it('archive does not gate (toast-only by design)', () => {
		expect(repoActions.archive.confirm).toBeUndefined()
	})

	it('sync isApplicable returns false for non-mirror repos', () => {
		expect(repoActions.sync.isApplicable({ isMirror: false })).toBe(false)
		expect(repoActions.sync.isApplicable({ isMirror: true })).toBe(true)
	})
})

describe('destructive: delete', () => {
	it('delete is registered with destructive intent', () => {
		expect(repoActions.delete).toBeDefined()
		expect(repoActions.delete.intent).toBe('destructive')
	})

	it('delete confirm uses danger variant and type-name verification', () => {
		const cfg = repoActions.delete.confirm({ name: 'my-repo', full_name: 'me/my-repo' })
		expect(cfg.variant).toBe('danger')
		expect(cfg.requiresInput).toBe('my-repo')
	})

	it('delete does NOT trigger refresh (wrapper handles it)', () => {
		expect(repoActions.delete.triggersRefresh).toBeFalsy()
	})
})

describe('AI read-only actions', () => {
	it('all five AI read-only entries are present', () => {
		expect(repoActions.ai_commit).toBeDefined()
		expect(repoActions.ai_pr).toBeDefined()
		expect(repoActions.ai_quality).toBeDefined()
		expect(repoActions.ai_compare).toBeDefined()
		expect(repoActions.ai_security).toBeDefined()
	})

	it('AI read-only actions do not trigger refresh', () => {
		for (const id of ['ai_commit', 'ai_pr', 'ai_quality', 'ai_compare', 'ai_security']) {
			expect(repoActions[id].triggersRefresh, `${id}`).toBeFalsy()
		}
	})

	it('ai_quality is on the quickAction surface with priority 40', () => {
		expect(repoActions.ai_quality.surfaces).toContain('quickAction')
		expect(repoActions.ai_quality.quickActionPriority).toBe(40)
	})
})
