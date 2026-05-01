import { describe, it, expect, vi } from 'vitest'
import { prActions, buildPRActionCommands } from '../../src/actions/prActions'

const VALID_INTENTS = ['navigation', 'copy', 'mutation', 'destructive', 'read-only']
const VALID_SURFACES = ['inlineButton', 'commandPalette', 'contextMenu']

const mkPR = (overrides = {}) => ({
    number: 42,
    title: 'Improve README',
    html_url: 'https://github.com/o/r/pull/42',
    state: 'open',
    merged: false,
    merged_at: null,
    head: { ref: 'feature/branch' },
    user: { login: 'octocat' },
    ...overrides,
})

describe('prActions registry — shape', () => {
    it('exports an object', () => {
        expect(typeof prActions).toBe('object')
        expect(prActions).not.toBeNull()
    })

    it('every action has required fields and a snake_case id', () => {
        for (const [id, action] of Object.entries(prActions)) {
            expect(action.id, `id field for ${id}`).toBe(id)
            expect(id, `${id} is snake_case`).toMatch(/^[a-z][a-z0-9_]*$/)
            expect(action.label, `label for ${id}`).toBeDefined()
            expect(action.icon, `icon for ${id}`).toBeDefined()
            expect(VALID_INTENTS, `intent for ${id}`).toContain(action.intent)
            expect(Array.isArray(action.surfaces), `surfaces for ${id}`).toBe(true)
            expect(action.surfaces.length, `surfaces for ${id}`).toBeGreaterThan(0)
            action.surfaces.forEach((s) => {
                expect(VALID_SURFACES, `surface ${s} on ${id}`).toContain(s)
            })
            expect(typeof action.run, `run() for ${id}`).toBe('function')
        }
    })

    it('has the expected core entries', () => {
        for (const id of ['view_pr', 'open_pr_on_github', 'copy_pr_url', 'copy_pr_branch',
            'start_review', 'generate_description', 'merge_pr', 'close_pr']) {
            expect(prActions[id], id).toBeDefined()
        }
    })
})

describe('prActions — applicability', () => {
    it('start_review and merge_pr only apply to open, unmerged PRs', () => {
        expect(prActions.start_review.isApplicable(mkPR({ state: 'open' }))).toBe(true)
        expect(prActions.start_review.isApplicable(mkPR({ state: 'closed' }))).toBe(false)
        expect(prActions.start_review.isApplicable(mkPR({ merged: true }))).toBe(false)

        expect(prActions.merge_pr.isApplicable(mkPR({ state: 'open' }))).toBe(true)
        expect(prActions.merge_pr.isApplicable(mkPR({ merged_at: '2026-01-01' }))).toBe(false)
    })

    it('close_pr only applies to open PRs', () => {
        expect(prActions.close_pr.isApplicable(mkPR({ state: 'open' }))).toBe(true)
        expect(prActions.close_pr.isApplicable(mkPR({ state: 'closed' }))).toBe(false)
    })

    it('open_pr_on_github gates on html_url', () => {
        expect(prActions.open_pr_on_github.isApplicable(mkPR())).toBe(true)
        expect(prActions.open_pr_on_github.isApplicable(mkPR({ html_url: '' }))).toBe(false)
    })
})

describe('prActions — confirms', () => {
    it('merge_pr confirm uses warning variant + names the PR', () => {
        const cfg = prActions.merge_pr.confirm(mkPR())
        expect(cfg.variant).toBe('warning')
        expect(cfg.message).toContain('#42')
        expect(cfg.confirmText).toBe('Merge')
    })

    it('close_pr confirm warns about reopen ability', () => {
        const cfg = prActions.close_pr.confirm(mkPR())
        expect(cfg.variant).toBe('warning')
        expect(cfg.message.toLowerCase()).toMatch(/reopen/)
    })
})

describe('prActions — run() side effects', () => {
    it('view_pr calls ctx.onSelectPR with the target', async () => {
        const ctx = { onSelectPR: vi.fn() }
        const pr = mkPR()
        await prActions.view_pr.run(pr, ctx)
        expect(ctx.onSelectPR).toHaveBeenCalledWith(pr)
    })

    it('merge_pr calls api.mergePull then refresh', async () => {
        const ctx = {
            api: { mergePull: vi.fn(async () => ({})) },
            toast: { success: vi.fn() },
            refresh: vi.fn(),
        }
        await prActions.merge_pr.run(mkPR(), ctx)
        expect(ctx.api.mergePull).toHaveBeenCalledWith(42)
        expect(ctx.refresh).toHaveBeenCalled()
        expect(ctx.toast.success).toHaveBeenCalledWith('Merged PR #42')
    })

    it('close_pr calls api.updatePull with state:closed', async () => {
        const ctx = {
            api: { updatePull: vi.fn(async () => ({})) },
            toast: { success: vi.fn() },
            refresh: vi.fn(),
        }
        await prActions.close_pr.run(mkPR(), ctx)
        expect(ctx.api.updatePull).toHaveBeenCalledWith(42, { state: 'closed' })
        expect(ctx.refresh).toHaveBeenCalled()
    })
})

describe('buildPRActionCommands', () => {
    it('emits one command per applicable action × pr, scoped to commandPalette surface', () => {
        const prs = [mkPR({ number: 1 }), mkPR({ number: 2, state: 'closed' })]
        const ctx = { onSelectPR: vi.fn(), onStartReview: vi.fn(), onGenerateDescription: vi.fn(), api: {}, toast: { success: vi.fn() }, refresh: vi.fn() }
        const cmds = buildPRActionCommands(prs, ctx)

        expect(cmds.length).toBeGreaterThan(0)
        for (const cmd of cmds) {
            expect(cmd.id).toMatch(/::\d+$/)
            expect(typeof cmd.run).toBe('function')
            expect(cmd.label).toMatch(/—\s+#\d+/)
        }
        // start_review should appear for #1 (open) but not #2 (closed)
        expect(cmds.some(c => c.id === 'start_review::1')).toBe(true)
        expect(cmds.some(c => c.id === 'start_review::2')).toBe(false)
    })

    it('returns [] when prs is empty', () => {
        expect(buildPRActionCommands([], {})).toEqual([])
    })
})
