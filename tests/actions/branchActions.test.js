import { describe, it, expect, vi } from 'vitest'
import { branchActions, buildBranchActionCommands } from '../../src/actions/branchActions'

const VALID_INTENTS = ['navigation', 'copy', 'mutation', 'destructive', 'read-only']
const VALID_SURFACES = ['inlineButton', 'commandPalette', 'contextMenu']

const mkBranch = (overrides = {}) => ({
    name: 'feature/x',
    protected: false,
    commit: { sha: 'abc123' },
    ...overrides,
})

describe('branchActions registry — shape', () => {
    it('every action has required fields and a snake_case id', () => {
        for (const [id, action] of Object.entries(branchActions)) {
            expect(action.id).toBe(id)
            expect(id).toMatch(/^[a-z][a-z0-9_]*$/)
            expect(action.label).toBeDefined()
            expect(action.icon).toBeDefined()
            expect(VALID_INTENTS).toContain(action.intent)
            expect(Array.isArray(action.surfaces)).toBe(true)
            action.surfaces.forEach((s) => expect(VALID_SURFACES).toContain(s))
            expect(typeof action.run).toBe('function')
        }
    })

    it('has the expected core entries', () => {
        for (const id of ['open_branch_on_github', 'copy_branch_name', 'copy_branch_checkout_cmd',
            'protect_branch', 'delete_branch']) {
            expect(branchActions[id], id).toBeDefined()
        }
    })
})

describe('branchActions — applicability + confirms', () => {
    it('delete_branch refuses protected branches', () => {
        expect(branchActions.delete_branch.isApplicable(mkBranch({ protected: true }))).toBe(false)
        expect(branchActions.delete_branch.isApplicable(mkBranch({ protected: false }))).toBe(true)
    })

    it('delete_branch confirm requires typing the branch name', () => {
        const cfg = branchActions.delete_branch.confirm(mkBranch({ name: 'my-feature' }))
        expect(cfg.requiresInput).toBe('my-feature')
        expect(cfg.variant).toBe('danger')
    })

    it('protect_branch label flips depending on current state', () => {
        expect(branchActions.protect_branch.label(mkBranch({ protected: false }))).toMatch(/Add/)
        expect(branchActions.protect_branch.label(mkBranch({ protected: true }))).toMatch(/Edit/)
    })

    it('open_branch_on_github gates on repoFullName ctx (no ctx → not applicable)', () => {
        expect(branchActions.open_branch_on_github.isApplicable(mkBranch(), {})).toBe(false)
        expect(branchActions.open_branch_on_github.isApplicable(mkBranch(), { repoFullName: 'a/b' })).toBe(true)
    })
})

describe('branchActions — run() side effects', () => {
    it('delete_branch calls api.deleteBranch with branch name + refreshes', async () => {
        const ctx = {
            api: { deleteBranch: vi.fn(async () => ({})) },
            toast: { success: vi.fn() },
            refresh: vi.fn(),
        }
        await branchActions.delete_branch.run(mkBranch({ name: 'feature/x' }), ctx)
        expect(ctx.api.deleteBranch).toHaveBeenCalledWith('feature/x')
        expect(ctx.refresh).toHaveBeenCalled()
    })

    it('protect_branch opens the protection modal', async () => {
        const ctx = { openModalWithData: vi.fn() }
        await branchActions.protect_branch.run(mkBranch({ name: 'main' }), ctx)
        expect(ctx.openModalWithData).toHaveBeenCalledWith('showBranchProtection', { branch: 'main' })
    })
})

describe('buildBranchActionCommands', () => {
    it('emits one command per applicable action × branch', () => {
        const branches = [mkBranch({ name: 'main', protected: true }), mkBranch({ name: 'feature/x' })]
        const ctx = { repoFullName: 'o/r', api: {}, toast: { success: vi.fn() }, refresh: vi.fn() }
        const cmds = buildBranchActionCommands(branches, ctx)
        const ids = cmds.map(c => c.id)
        // delete_branch should appear for unprotected feature/x but not main.
        expect(ids).toContain('delete_branch::feature/x')
        expect(ids).not.toContain('delete_branch::main')
    })

    it('returns [] for empty branches', () => {
        expect(buildBranchActionCommands([], {})).toEqual([])
    })
})
