import { describe, it, expect } from 'vitest'
import { normalizeTransferModalData } from '../../src/utils/transferModalData'

const repo = { id: 1, name: 'demo', full_name: 'me/demo', owner: { login: 'me' } }

describe('normalizeTransferModalData', () => {
	it('passes an array of repos straight through as transfer mode', () => {
		const repos = [repo, { ...repo, id: 2, full_name: 'me/two' }]
		expect(normalizeTransferModalData(repos)).toEqual({ repos, action: 'transfer' })
	})

	it('wraps a bare single repo object in an array (the crash regression)', () => {
		expect(normalizeTransferModalData(repo)).toEqual({ repos: [repo], action: 'transfer' })
	})

	it('reads { repos, action } payloads and preserves mirror mode', () => {
		expect(normalizeTransferModalData({ repos: [repo], action: 'mirror' }))
			.toEqual({ repos: [repo], action: 'mirror' })
	})

	it('wraps a single repo nested under .repos', () => {
		expect(normalizeTransferModalData({ repos: repo, action: 'mirror' }))
			.toEqual({ repos: [repo], action: 'mirror' })
	})

	it('degrades null/undefined/garbage to an empty transfer list (no throw)', () => {
		expect(normalizeTransferModalData(null)).toEqual({ repos: [], action: 'transfer' })
		expect(normalizeTransferModalData(undefined)).toEqual({ repos: [], action: 'transfer' })
		expect(normalizeTransferModalData(42)).toEqual({ repos: [], action: 'transfer' })
	})

	it('only honors action="mirror"; anything else falls back to transfer', () => {
		expect(normalizeTransferModalData({ repos: [repo], action: 'bogus' }).action).toBe('transfer')
	})
})
