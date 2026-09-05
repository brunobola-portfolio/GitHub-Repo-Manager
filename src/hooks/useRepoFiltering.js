import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { aiApi } from '../api/ai'
import { useUrlParams } from './useUrlParams'

/**
 * Owns the RepoList filter/search state and derives the filtered, sorted list.
 *
 * Behaviour preserved from the original RepoList.jsx:
 * - AI results indexed in a Map for O(1) lookup and sorted by score desc.
 * - Plain-text search only runs when AI mode is OFF (matches name or description).
 * - Type/visibility/language filters apply in both modes.
 * - AI search fires with a 500ms debounce, only for queries longer than 2 chars.
 *
 * G5: search/type/visibility/language/sort are synced to the URL query
 * string (`?q=&type=&visibility=&lang=&sort=`) via useUrlParams — the same
 * "URL is the source of truth" pattern WorkBoardPage uses — so a filtered
 * Repositories view is bookmarkable/shareable, and so a saved view (see
 * useSavedViews) can be "applied" by simply writing these params.
 *
 * Optional `initial` argument seeds the filter/sort state when the URL
 * doesn't already carry a value for it — used by Dashboard StatCards that
 * navigate with a pre-selected filter (e.g. "Archived Repos" sets
 * `{ type: 'archived' }`). An explicit URL value always wins over `initial`.
 */
export function useRepoFiltering(repos, initial = {}) {
	const [urlParams, setUrlParams] = useUrlParams(['q', 'type', 'visibility', 'lang', 'sort'])
	const [isAISearch, setIsAISearch] = useState(false)
	const [aiResults, setAiResults] = useState([])
	const [isSearchingAI, setIsSearchingAI] = useState(false)
	const [aiSearchError, setAiSearchError] = useState(null)

	const searchQuery = urlParams.q
	const typeFilter = urlParams.type || initial.type || 'all'
	const visibilityFilter = urlParams.visibility || initial.visibility || 'all'
	const languageFilter = urlParams.lang || 'all'
	// Sort key — seeded from Dashboard StatCards (e.g. "Total Stars" sets
	// initialSort='stars'). Default 'name' preserves the legacy alphabetical
	// order. AI-search ranks by score and bypasses this entirely.
	const sortBy = urlParams.sort || initial.sort || 'name'

	const setSearchQuery = (v) => setUrlParams({ q: v })
	const setTypeFilter = (v) => setUrlParams({ type: v === 'all' ? '' : v })
	const setVisibilityFilter = (v) => setUrlParams({ visibility: v === 'all' ? '' : v })
	const setLanguageFilter = (v) => setUrlParams({ lang: v === 'all' ? '' : v })
	const setSortBy = (v) => setUrlParams({ sort: (v === 'name' || !v) ? '' : v })

	// Applies a saved view (useSavedViews filters shape) in one URL write —
	// used by the Repositories filter bar's PresetDropdown "apply" action.
	const applyFilters = (filters = {}) => {
		const { q = '', type = '', visibility = '', lang = '', sort = '' } = filters
		setUrlParams({ q, type: type === 'all' ? '' : type, visibility: visibility === 'all' ? '' : visibility, lang: lang === 'all' ? '' : lang, sort: sort === 'name' ? '' : sort })
	}

	const availableLanguages = useMemo(
		() => [...new Set(repos.map(r => r.language).filter(Boolean))].sort(),
		[repos]
	)

	// The text filter runs against the deferred value so the input keeps
	// echoing keystrokes while the grid (and its exit animations) catches up:
	// the worst keystroke measured 290 ms to next paint at 30 cards.
	const deferredQuery = useDeferredValue(searchQuery)

	const filteredRepos = useMemo(() => {
		const aiResultsMap = isAISearch && aiResults.length > 0
			? new Map(aiResults.map(res => [res.repo_id, res]))
			: null

		const filtered = repos.filter(repo => {
			if (aiResultsMap) {
				const match = aiResultsMap.get(repo.id)
				if (!match) return false
			}

			if (deferredQuery && !isAISearch) {
				const query = deferredQuery.toLowerCase()
				const matchesName = repo.name.toLowerCase().includes(query)
				const matchesDesc = repo.description?.toLowerCase().includes(query)
				if (!matchesName && !matchesDesc) return false
			}

			if (typeFilter === 'source' && repo.fork) return false
			if (typeFilter === 'fork' && !repo.fork) return false
			if (typeFilter === 'archived' && !repo.archived) return false

			if (visibilityFilter === 'public' && repo.private) return false
			if (visibilityFilter === 'private' && !repo.private) return false

			if (languageFilter !== 'all' && repo.language !== languageFilter) return false

			return true
		})

		if (aiResultsMap && filtered.length > 0) {
			return filtered.sort((a, b) => {
				const scoreA = aiResultsMap.get(a.id)?.score || 0
				const scoreB = aiResultsMap.get(b.id)?.score || 0
				return scoreB - scoreA
			})
		}

		// Apply user/initial sort. Numeric sorts go descending (more stars
		// first feels right; same for forks, recent updates, recent creation).
		const sorters = {
			name:    (a, b) => a.name.localeCompare(b.name),
			stars:   (a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0),
			forks:   (a, b) => (b.forks_count || 0) - (a.forks_count || 0),
			updated: (a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0),
			created: (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0),
		}
		const sorter = sorters[sortBy] || sorters.name
		return [...filtered].sort(sorter)
	}, [repos, aiResults, isAISearch, deferredQuery, typeFilter, visibilityFilter, languageFilter, sortBy])

	useEffect(() => {
		let aborted = false
		const delayDebounce = setTimeout(async () => {
			if (isAISearch && searchQuery.length > 2) {
				setIsSearchingAI(true)
				setAiSearchError(null)
				try {
					const results = await aiApi.search(searchQuery)
					if (!aborted) setAiResults(results)
				} catch {
					if (!aborted) {
						setAiSearchError('AI search unavailable. Try regular search.')
						setAiResults([])
					}
				} finally {
					if (!aborted) setIsSearchingAI(false)
				}
			} else if (isAISearch && !searchQuery) {
				if (!aborted) {
					setAiResults([])
					setAiSearchError(null)
				}
			}
		}, 500)

		return () => { aborted = true; clearTimeout(delayDebounce) }
	}, [searchQuery, isAISearch])

	const clearAllFilters = () => {
		setUrlParams({ q: '', type: '', visibility: '', lang: '', sort: '' })
	}

	const hasActiveFilters =
		Boolean(searchQuery) ||
		typeFilter !== 'all' ||
		visibilityFilter !== 'all' ||
		languageFilter !== 'all'

	return {
		// state
		searchQuery,
		setSearchQuery,
		isAISearch,
		setIsAISearch,
		aiResults,
		isSearchingAI,
		aiSearchError,
		typeFilter,
		setTypeFilter,
		visibilityFilter,
		setVisibilityFilter,
		languageFilter,
		setLanguageFilter,
		sortBy,
		setSortBy,
		// derived
		availableLanguages,
		filteredRepos,
		hasActiveFilters,
		// actions
		clearAllFilters,
		applyFilters,
	}
}
