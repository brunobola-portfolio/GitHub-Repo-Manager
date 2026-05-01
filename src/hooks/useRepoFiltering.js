import { useEffect, useMemo, useState } from 'react'
import { aiApi } from '../api/ai'

/**
 * Owns the RepoList filter/search state and derives the filtered, sorted list.
 *
 * Behaviour preserved from the original RepoList.jsx:
 * - AI results indexed in a Map for O(1) lookup and sorted by score desc.
 * - Plain-text search only runs when AI mode is OFF (matches name or description).
 * - Type/visibility/language filters apply in both modes.
 * - AI search fires with a 500ms debounce, only for queries longer than 2 chars.
 *
 * Optional `initial` argument seeds the filter/sort state on first mount only —
 * used by Dashboard StatCards that navigate with a pre-selected filter (e.g.
 * "Archived Repos" sets `{ type: 'archived' }`). Subsequent renders ignore it.
 */
export function useRepoFiltering(repos, initial = {}) {
	const [searchQuery, setSearchQuery] = useState('')
	const [isAISearch, setIsAISearch] = useState(false)
	const [aiResults, setAiResults] = useState([])
	const [isSearchingAI, setIsSearchingAI] = useState(false)
	const [aiSearchError, setAiSearchError] = useState(null)

	const [typeFilter, setTypeFilter] = useState(() => initial.type || 'all')
	const [visibilityFilter, setVisibilityFilter] = useState(() => initial.visibility || 'all')
	const [languageFilter, setLanguageFilter] = useState('all')

	const availableLanguages = useMemo(
		() => [...new Set(repos.map(r => r.language).filter(Boolean))].sort(),
		[repos]
	)

	const filteredRepos = useMemo(() => {
		const aiResultsMap = isAISearch && aiResults.length > 0
			? new Map(aiResults.map(res => [res.repo_id, res]))
			: null

		const filtered = repos.filter(repo => {
			if (aiResultsMap) {
				const match = aiResultsMap.get(repo.id)
				if (!match) return false
			}

			if (searchQuery && !isAISearch) {
				const query = searchQuery.toLowerCase()
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

		return filtered
	}, [repos, aiResults, isAISearch, searchQuery, typeFilter, visibilityFilter, languageFilter])

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
		setSearchQuery('')
		setTypeFilter('all')
		setVisibilityFilter('all')
		setLanguageFilter('all')
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
		// derived
		availableLanguages,
		filteredRepos,
		hasActiveFilters,
		// actions
		clearAllFilters,
	}
}
