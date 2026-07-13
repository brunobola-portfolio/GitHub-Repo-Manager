import { describe, it, expect, vi } from 'vitest'
import { issueActions, buildIssueActionCommands } from '../../src/actions/issueActions'

const VALID_INTENTS = ['navigation', 'copy', 'mutation', 'destructive', 'read-only']
const VALID_SURFACES = ['inlineButton', 'commandPalette', 'contextMenu']

const mkIssue = (overrides = {}) => ({
    number: 7,
    title: 'Fix navbar alignment',
    html_url: 'https://github.com/o/r/issues/7',
    state: 'open',
    user: { login: 'alice' },
    ...overrides,
})

describe('issueActions registry — shape', () => {
    it('every action has required fields and a snake_case id', () => {
        for (const [id, action] of Object.entries(issueActions)) {
            expect(action.id).toBe(id)
            expect(id).toMatch(/^[a-z][a-z0-9_]*$/)
            expect(action.label).toBeDefined()
            expect(action.icon).toBeDefined()
            expect(VALID_INTENTS).toContain(action.intent)
            action.surfaces.forEach((s) => expect(VALID_SURFACES).toContain(s))
            expect(typeof action.run).toBe('function')
        }
    })

    it('has the expected core entries', () => {
        for (const id of ['view_issue', 'open_issue_on_github', 'copy_issue_url', 'copy_issue_ref',
            'plan_issue', 'comment_on_issue', 'close_issue', 'reopen_issue']) {
            expect(issueActions[id], id).toBeDefined()
        }
    })
})

describe('issueActions — applicability + confirm', () => {
    it('plan_issue + close_issue only apply to open issues', () => {
        expect(issueActions.plan_issue.isApplicable(mkIssue({ state: 'open' }))).toBe(true)
        expect(issueActions.plan_issue.isApplicable(mkIssue({ state: 'closed' }))).toBe(false)
        expect(issueActions.close_issue.isApplicable(mkIssue({ state: 'open' }))).toBe(true)
        expect(issueActions.close_issue.isApplicable(mkIssue({ state: 'closed' }))).toBe(false)
    })

    it('reopen_issue only applies to closed issues', () => {
        expect(issueActions.reopen_issue.isApplicable(mkIssue({ state: 'closed' }))).toBe(true)
        expect(issueActions.reopen_issue.isApplicable(mkIssue({ state: 'open' }))).toBe(false)
    })

    it('close_issue declares no confirm — issue close/reopen is deliberately confirmless', () => {
        // Codifies the decision (no surface routes close_issue through a
        // confirm gate; unlike PR merge/close, closing an issue is trivially
        // reversible). A `confirm` block here would be dead code — see the
        // comment above close_issue in issueActions.js.
        expect(issueActions.close_issue.confirm).toBeUndefined()
        expect(issueActions.reopen_issue.confirm).toBeUndefined()
    })
})

describe('issueActions — run() side effects', () => {
    it('view_issue calls ctx.onSelectIssue with the target', async () => {
        const ctx = { onSelectIssue: vi.fn() }
        const issue = mkIssue()
        await issueActions.view_issue.run(issue, ctx)
        expect(ctx.onSelectIssue).toHaveBeenCalledWith(issue)
    })

    it('comment_on_issue forwards focusComment hint', async () => {
        const ctx = { onSelectIssue: vi.fn() }
        const issue = mkIssue()
        await issueActions.comment_on_issue.run(issue, ctx)
        expect(ctx.onSelectIssue).toHaveBeenCalledWith(issue, { focusComment: true })
    })

    it('close_issue + reopen_issue each call api.updateIssue with the right state', async () => {
        const ctx = {
            api: { updateIssue: vi.fn(async () => ({})) },
            toast: { success: vi.fn() },
            refresh: vi.fn(),
        }
        await issueActions.close_issue.run(mkIssue(), ctx)
        expect(ctx.api.updateIssue).toHaveBeenCalledWith(7, { state: 'closed' })

        await issueActions.reopen_issue.run(mkIssue({ state: 'closed' }), ctx)
        expect(ctx.api.updateIssue).toHaveBeenCalledWith(7, { state: 'open' })
        expect(ctx.refresh).toHaveBeenCalledTimes(2)
    })
})

describe('buildIssueActionCommands', () => {
    it('emits the right commands per state', () => {
        const issues = [mkIssue({ number: 1, state: 'open' }), mkIssue({ number: 2, state: 'closed' })]
        const ctx = { onSelectIssue: vi.fn(), onPlanWithAI: vi.fn(), api: {}, toast: { success: vi.fn() }, refresh: vi.fn() }
        const ids = buildIssueActionCommands(issues, ctx).map(c => c.id)

        // Open: close_issue + plan_issue should be there; reopen_issue should not.
        expect(ids).toContain('close_issue::1')
        expect(ids).toContain('plan_issue::1')
        expect(ids).not.toContain('reopen_issue::1')

        // Closed: reopen_issue should be there; close_issue + plan_issue should not.
        expect(ids).toContain('reopen_issue::2')
        expect(ids).not.toContain('close_issue::2')
        expect(ids).not.toContain('plan_issue::2')
    })

    it('returns [] for empty issues', () => {
        expect(buildIssueActionCommands([], {})).toEqual([])
    })
})
