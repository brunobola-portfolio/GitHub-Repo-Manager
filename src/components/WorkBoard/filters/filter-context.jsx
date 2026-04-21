/**
 * Work Board filter context provider.
 *
 * Only the `FilterProvider` component lives here so React Fast Refresh works
 * on this `.jsx` file. The `FilterContext`, the `useWorkBoardFilters` hook
 * and the pure `applyFilters` helper live in `filter-context-helpers.js`.
 */

import { useMemo } from 'react'
import { FilterContext, DEFAULT_PARAMS } from './filter-context-helpers'

export function FilterProvider({ params, availableRepos, availableAuthors, availableLabels, children }) {
    const value = useMemo(() => ({
        params: params || DEFAULT_PARAMS,
        availableRepos: availableRepos || [],
        availableAuthors: availableAuthors || [],
        availableLabels: availableLabels || [],
    }), [params, availableRepos, availableAuthors, availableLabels])
    return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>
}
