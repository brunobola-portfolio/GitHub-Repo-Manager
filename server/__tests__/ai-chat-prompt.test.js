import { describe, it, expect } from 'vitest'
import { buildChatPrompt } from '../lib/ai-chat-prompt.js'

describe('buildChatPrompt', () => {
    const sample = buildChatPrompt({ message: 'posso editar a descrição?', context: { user: 'alice' } })

    it('positions the assistant as in-app, not generic GitHub helper', () => {
        expect(sample).toMatch(/in-app assistant|embedded inside.*GitHub Repo Manager/i)
        expect(sample).toMatch(/not.*github\.com|not a generic/i)
    })

    it('includes a capabilities catalog covering the main app surfaces', () => {
        // Repo detail tabs the user is most likely to ask about
        expect(sample).toMatch(/Overview/)
        expect(sample).toMatch(/Settings/)
        expect(sample).toMatch(/Branches/)
        expect(sample).toMatch(/Releases/)
        expect(sample).toMatch(/Pull Requests/)
        expect(sample).toMatch(/Issues/)
        // Migration features
        expect(sample).toMatch(/Migration Wizard/)
        expect(sample).toMatch(/Migration History/)
        // Repo lifecycle
        expect(sample).toMatch(/Create Repository/)
        expect(sample).toMatch(/Transfer Repository/)
        expect(sample).toMatch(/Archive|archive/)
    })

    it('mentions the inline-edit affordance for description and website', () => {
        // Specific surface the user complained about — the AI must know this
        // exists so it stops sending people to github.com to edit descriptions.
        expect(sample).toMatch(/inline-editable|inline edit|edit.*inline|click the text/i)
        expect(sample).toMatch(/[Dd]escription/)
        expect(sample).toMatch(/[Ww]ebsite/)
    })

    it('explicitly tells the model to prefer in-app paths over github.com', () => {
        expect(sample).toMatch(/Stay in this app|in-app path|whenever possible/i)
        expect(sample).toMatch(/github\.com.*only|only.*github\.com|app genuinely lacks/i)
    })

    it('lists every whitelisted action type', () => {
        const expected = [
            'open_migration_wizard',
            'open_migration_history',
            'open_create_repo',
            'open_transfer',
            'open_settings',
            'open_repo_settings',
        ]
        for (const action of expected) {
            expect(sample).toContain(action)
        }
    })

    it('documents the open_repo_settings payload shape and disambiguation rule', () => {
        // The model must learn that this action needs owner+repo, and that
        // it should ask if the repo is ambiguous instead of guessing.
        expect(sample).toMatch(/open_repo_settings/)
        expect(sample).toMatch(/owner.*repo|"owner".*"repo"/)
        expect(sample).toMatch(/ambiguous|ask.*which repo/i)
    })

    it('lists the new manual settings (topics manual, merge settings, archive)', () => {
        // Catalog must reflect what the Settings tab actually does so the
        // assistant doesn't tell users to go to github.com for these.
        expect(sample).toMatch(/manual editor|add \/ remove|manual.*topic/i)
        expect(sample).toMatch(/merge settings|merge.*squash.*rebase|allow merge/i)
        expect(sample).toMatch(/Archive|archived?/i)
    })

    it('instructs the model to match the user\'s language (and PT-PT vs PT-BR)', () => {
        expect(sample).toMatch(/user's language|same language|reply in/i)
        expect(sample).toMatch(/European Portuguese|português europeu|brasileiro/i)
    })

    it('includes the JSON output schema with reply + actions', () => {
        expect(sample).toMatch(/"reply"/)
        expect(sample).toMatch(/"actions"/)
        expect(sample).toMatch(/"type"/)
        expect(sample).toMatch(/"label"/)
    })

    it('embeds the user message and context verbatim', () => {
        expect(sample).toContain('posso editar a descrição?')
        expect(sample).toContain('"user"')
        expect(sample).toContain('"alice"')
    })

    it('handles missing or non-object context gracefully', () => {
        expect(() => buildChatPrompt({ message: 'hi' })).not.toThrow()
        expect(() => buildChatPrompt({ message: 'hi', context: null })).not.toThrow()
        const nullCtx = buildChatPrompt({ message: 'hi', context: null })
        expect(nullCtx).toContain('hi')
        expect(nullCtx).toMatch(/\{\}/)
    })

    it('forbids inventing action types and duplicate actions', () => {
        expect(sample).toMatch(/never invent|Never invent/)
        expect(sample).toMatch(/duplicate|at most one/)
    })
})
