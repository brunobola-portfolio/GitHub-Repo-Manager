/**
 * Pure builder — produces cmdk command items relevant only when the user is
 * on the repository list view (activeView === 'repos'). No React.
 *
 * @typedef {object} ReposCommand
 * @property {string} id
 * @property {string} label
 * @property {string} searchValue
 * @property {string} icon
 * @property {'event'} kind
 * @property {string} event
 * @property {*} [detail]
 */

/**
 * @returns {ReposCommand[]}
 */
export function buildReposCommands() {
    return [
        {
            id: 'repos-show-pinned',
            label: 'Filter: pinned only',
            searchValue: 'filter pinned',
            icon: 'Pin',
            kind: 'event',
            event: 'repos:set-filter',
            detail: 'pinned',
        },
        {
            id: 'repos-show-archived',
            label: 'Filter: include archived',
            searchValue: 'filter archived',
            icon: 'Archive',
            kind: 'event',
            event: 'repos:set-filter',
            detail: 'archived',
        },
        {
            id: 'repos-clear-filters',
            label: 'Clear all filters',
            searchValue: 'clear repo filters',
            icon: 'Eraser',
            kind: 'event',
            event: 'repos:clear-filters',
        },
        {
            id: 'repos-sort-stars',
            label: 'Sort by stars',
            searchValue: 'sort repos stars',
            icon: 'Star',
            kind: 'event',
            event: 'repos:sort',
            detail: 'stars',
        },
        {
            id: 'repos-sort-updated',
            label: 'Sort by recently updated',
            searchValue: 'sort repos updated',
            icon: 'Clock',
            kind: 'event',
            event: 'repos:sort',
            detail: 'updated',
        },
        {
            id: 'repos-sort-name',
            label: 'Sort by name',
            searchValue: 'sort repos name',
            icon: 'ArrowDownAZ',
            kind: 'event',
            event: 'repos:sort',
            detail: 'name',
        },
    ]
}
