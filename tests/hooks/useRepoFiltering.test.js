import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRepoFiltering } from '@/hooks/useRepoFiltering'

const repos = [
	{ id: 1, name: 'a', private: false, archived: false, fork: false, language: 'JS' },
	{ id: 2, name: 'b', private: true, archived: false, fork: false, language: 'TS' },
	{ id: 3, name: 'c', private: false, archived: true, fork: false, language: 'JS' },
	{ id: 4, name: 'd', private: false, archived: false, fork: true, language: 'Go' },
]

beforeEach(() => {
	window.history.replaceState(null, '', window.location.pathname)
})

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

describe('useRepoFiltering — URL sync (G5)', () => {
	it('seeds filters from an existing URL query string', () => {
		window.history.replaceState(null, '', '/?q=hello&type=fork&visibility=private&lang=Go&sort=stars')
		const { result } = renderHook(() => useRepoFiltering(repos))
		expect(result.current.searchQuery).toBe('hello')
		expect(result.current.typeFilter).toBe('fork')
		expect(result.current.visibilityFilter).toBe('private')
		expect(result.current.languageFilter).toBe('Go')
		expect(result.current.sortBy).toBe('stars')
	})

	it('an explicit URL value wins over `initial`', () => {
		window.history.replaceState(null, '', '/?type=fork')
		const { result } = renderHook(() => useRepoFiltering(repos, { type: 'archived' }))
		expect(result.current.typeFilter).toBe('fork')
	})

	it('writes filter changes into the URL query string', () => {
		const { result } = renderHook(() => useRepoFiltering(repos))
		act(() => { result.current.setTypeFilter('fork') })
		expect(window.location.search).toContain('type=fork')
		act(() => { result.current.setSearchQuery('acme') })
		expect(window.location.search).toContain('q=acme')
	})

	it('omits the "all"/"name" default from the URL instead of writing it literally', () => {
		const { result } = renderHook(() => useRepoFiltering(repos))
		act(() => { result.current.setTypeFilter('all') })
		expect(window.location.search).not.toContain('type=')
		act(() => { result.current.setSortBy('name') })
		expect(window.location.search).not.toContain('sort=')
	})

	it('clearAllFilters resets every synced param', () => {
		window.history.replaceState(null, '', '/?q=x&type=fork&visibility=private&lang=Go&sort=stars')
		const { result } = renderHook(() => useRepoFiltering(repos))
		act(() => { result.current.clearAllFilters() })
		expect(window.location.search).toBe('')
		expect(result.current.typeFilter).toBe('all')
	})

	it('applyFilters (saved-view apply) writes all five params in one shot', () => {
		const { result } = renderHook(() => useRepoFiltering(repos))
		act(() => { result.current.applyFilters({ q: 'foo', type: 'source', visibility: 'public', lang: 'JS', sort: 'updated' }) })
		expect(result.current.searchQuery).toBe('foo')
		expect(result.current.typeFilter).toBe('source')
		expect(result.current.visibilityFilter).toBe('public')
		expect(result.current.languageFilter).toBe('JS')
		expect(result.current.sortBy).toBe('updated')
	})
})
