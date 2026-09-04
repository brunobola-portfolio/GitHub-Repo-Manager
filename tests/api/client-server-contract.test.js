/*
 * Three routes 400'd on every call because the client and the schema disagreed
 * about the request body. A unit test on either side alone cannot catch that —
 * both were internally consistent — so this drives the REAL client function
 * with fetch stubbed, captures the body it actually sends, and parses it with
 * the REAL Zod schema the route validates against.
 *
 * That is the only shape of test that would have caught these before a user
 * did.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

import {
    branchCreateSchema,
    importCheckDuplicatesSchema,
    aiGenerateCommitSchema,
} from '../../server/lib/validators.js'


vi.mock('@/config', async (importOriginal) => ({
    ...(await importOriginal()),
    MOCK_MODE: false,
    API_BASE_URL: '',
}))
// fetchWithRetry (real, so createBranch actually calls captureBody's fetch
// mock) alongside a stubbed getCsrfToken — no need for the mock's own fetch
// stand-in to also answer the CSRF-token probe.
vi.mock('@/utils/api', async (importOriginal) => ({
    ...(await importOriginal()),
    getCsrfToken: vi.fn(async () => 'csrf'),
}))

const { useRepoDetail } = await import('@/hooks/useRepoDetail')

/** Capture the JSON body of the next fetch this call performs. */
function captureBody() {
    const sent = {}
    global.fetch = vi.fn(async (url, init) => {
        sent.url = url
        sent.body = init?.body ? JSON.parse(init.body) : undefined
        return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({}) }
    })
    return sent
}

beforeEach(() => { vi.restoreAllMocks() })

describe('POST /repos/:owner/:repo/branches', () => {
    it('sends a body the route schema accepts', async () => {
        const sent = captureBody()
        const { result } = renderHook(() => useRepoDetail('acme', 'api'))

        await result.current.createBranch('feature/new', 'main')

        const parsed = branchCreateSchema.safeParse(sent.body)
        expect(
            parsed.success,
            `schema rejected the client payload ${JSON.stringify(sent.body)}: ${parsed.error?.issues?.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`,
        ).toBe(true)
    })

    it('names the base by BRANCH, which is the only thing the route can resolve', async () => {
        // The route does GET /git/refs/heads/{from} to find the SHA itself. It
        // has no SHA input at all, so a base-SHA field could never work.
        const sent = captureBody()
        const { result } = renderHook(() => useRepoDetail('acme', 'api'))

        await result.current.createBranch('feature/new', 'develop')

        expect(sent.body).toEqual({ name: 'feature/new', from: 'develop' })
    })
})

describe('POST /ai/generate-commit', () => {
    it('accepts a repo whose description GitHub reports as null', () => {
        // CommitTab sends `description: selectedRepo.description` verbatim, and
        // the GitHub API returns null — not undefined — when a repository has
        // no description. `.optional()` alone rejects null, so this route 400'd
        // for every such repo. It is a metered path, so the failure also burnt
        // nothing but the user's patience.
        const payload = {
            diff: 'diff --git a/a b/a\n+x',
            repo_context: { name: 'acme/api', description: null },
        }
        const parsed = aiGenerateCommitSchema.safeParse(payload)
        expect(
            parsed.success,
            `schema rejected a null description: ${parsed.error?.issues?.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`,
        ).toBe(true)
    })

    it('still accepts a real description and an absent one', () => {
        expect(aiGenerateCommitSchema.safeParse({
            diff: 'd', repo_context: { name: 'a/b', description: 'A tool' },
        }).success).toBe(true)
        expect(aiGenerateCommitSchema.safeParse({
            diff: 'd', repo_context: { name: 'a/b' },
        }).success).toBe(true)
    })
})

describe('POST /import/check-duplicates', () => {
    it('accepts the payload CreateRepoModal sends', () => {
        const parsed = importCheckDuplicatesSchema.safeParse({ repos: ['my-repo'], targetOwner: undefined })
        expect(parsed.success).toBe(true)
    })
})

describe('diff-size ceilings agree across the routes one flow chains together', () => {
    // CommitTab generates from `diff`, then sends the SAME text as
    // `original_diff` when the user hits Refine. Accepting 60 000 on the first
    // call and 20 000 on the second means a 40 000-character diff produces a
    // commit message and then 400s the moment anyone tries to improve it.
    const big = 'x'.repeat(45_000)

    it('generate-commit accepts a large diff', () => {
        expect(aiGenerateCommitSchema.safeParse({ diff: big }).success).toBe(true)
    })

    it('refine accepts any diff generate-commit accepted', async () => {
        const { aiRefineSchema } = await import('../../server/lib/validators.js')
        const parsed = aiRefineSchema.safeParse({
            original_content: 'feat: x', original_diff: big, instruction: 'more_context',
        })
        expect(parsed.success, 'the refine step rejects a diff its own generate step accepted').toBe(true)
    })

    it('chat-refine accepts any diff generate-commit accepted', async () => {
        const { aiChatRefineSchema } = await import('../../server/lib/validators.js')
        const parsed = aiChatRefineSchema.safeParse({ message: 'shorter please', original_diff: big })
        expect(parsed.success, 'the chat-refine step rejects a diff its own generate step accepted').toBe(true)
    })
})
