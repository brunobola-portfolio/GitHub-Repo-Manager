import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useRepoFiltering } from '@/hooks/useRepoFiltering'

const repos = [
	{ id: 1, name: 'a', private: false, archived: false, fork: false, language: 'JS' },
	{ id: 2, name: 'b', private: true, archived: false, fork: false, language: 'TS' },
	{ id: 3, name: 'c', private: false, archived: true, fork: false, language: 'JS' },
	{ id: 4, name: 'd', private: false, archived: false, fork: true, language: 'Go' },
]

describe('useRepoFiltering — initial filters from Dashboard navigation', () => {
	it('seeds typeFilter from initial.type', () => {
		const { result } = renderHook(() => useRepoFiltering(repos, { type: 'archived' }))
		expect(result.current.typeFilter).toBe('archived')
		// Only the archived repo (id 3) should pass the filter.
		expect(result.current.filteredRepos.map(r => r.id)).toEqual([3])
	})

	it('seeds visibilityFilter from initial.visibility', () => {
		const { result } = renderHook(() => useRepoFiltering(repos, { visibility: 'public' }))
		expect(result.current.visibilityFilter).toBe('public')
		// Repos that are NOT private: 1, 3, 4
		expect(result.current.filteredRepos.map(r => r.id).sort()).toEqual([1, 3, 4])
	})

	it('seeds source filter (excludes forks)', () => {
		const { result } = renderHook(() => useRepoFiltering(repos, { type: 'source' }))
		expect(result.current.typeFilter).toBe('source')
		// Non-fork repos: 1, 2, 3
		expect(result.current.filteredRepos.map(r => r.id).sort()).toEqual([1, 2, 3])
	})

	it('defaults remain "all" when no initial filters are provided', () => {
		const { result } = renderHook(() => useRepoFiltering(repos))
		expect(result.current.typeFilter).toBe('all')
		expect(result.current.visibilityFilter).toBe('all')
	})

	it('empty initial object falls back to "all"', () => {
		const { result } = renderHook(() => useRepoFiltering(repos, {}))
		expect(result.current.typeFilter).toBe('all')
		expect(result.current.visibilityFilter).toBe('all')
	})
})
