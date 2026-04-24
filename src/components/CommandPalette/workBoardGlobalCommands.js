/**
 * Global Work Board commands — no repo context needed. Visible in the
 * palette regardless of active view.
 */

export const WORK_BOARD_GLOBAL_COMMANDS = [
    {
        id: 'wb-cmd-refresh-discovery',
        label: 'Refresh discovery',
        searchValue: 'refresh discovery',
        actionType: 'refresh-discovery',
        icon: 'RefreshCw',
    },
    {
        id: 'wb-cmd-refresh-board',
        label: 'Refresh Work Board',
        searchValue: 'refresh board',
        actionType: 'refresh-board',
        icon: 'RotateCw',
    },
    {
        id: 'wb-cmd-toggle-muted',
        label: 'Toggle muted repos in Work Board',
        searchValue: 'toggle muted',
        actionType: 'toggle-muted',
        icon: 'BellOff',
    },
    {
        id: 'wb-cmd-clear-filters',
        label: 'Clear Work Board filters',
        searchValue: 'clear filters',
        actionType: 'clear-filters',
        icon: 'Eraser',
    },
]
