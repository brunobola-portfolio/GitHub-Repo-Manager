import { describe, it, expect } from 'vitest'
import { WORK_BOARD_GLOBAL_COMMANDS } from '../../../src/components/CommandPalette/workBoardGlobalCommands'

describe('WORK_BOARD_GLOBAL_COMMANDS', () => {
    it('exposes 4 global commands', () => {
        expect(WORK_BOARD_GLOBAL_COMMANDS).toHaveLength(4)
    })

    it('includes Refresh discovery, Refresh board, Toggle muted, Clear filters', () => {
        const ids = WORK_BOARD_GLOBAL_COMMANDS.map(c => c.actionType).sort()
        expect(ids).toEqual(['clear-filters', 'refresh-board', 'refresh-discovery', 'toggle-muted'])
    })

    it('each command has id, label, searchValue, and icon', () => {
        for (const c of WORK_BOARD_GLOBAL_COMMANDS) {
            expect(c.id).toBeTruthy()
            expect(c.label).toBeTruthy()
            expect(c.searchValue).toBeTruthy()
            expect(c.icon).toBeTruthy()
        }
    })

    it('searchValue includes a verb so fuzzy matching feels natural', () => {
        const refresh = WORK_BOARD_GLOBAL_COMMANDS.find(c => c.actionType === 'refresh-discovery')
        expect(refresh.searchValue.toLowerCase()).toContain('refresh')
    })
})
