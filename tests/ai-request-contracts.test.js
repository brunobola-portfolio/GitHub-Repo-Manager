/**
 * Honesty gate: the payloads the client BUILDS must satisfy the Zod schemas the
 * server VALIDATES them with.
 *
 * This gate exists because POST /api/ai/review-summary shipped broken: the hook
 * sent `topFilePatches` as a joined string while aiReviewSummarySchema required
 * an array of { filename, patch }, so every call 400'd. The unit tests stayed
 * green the whole time because they mock `apiCall` and therefore only ever
 * assert the client against itself. Mocking the transport hides contract drift;
 * only running the real payload through the real schema catches it.
 *
 * When adding an AI route, add its builder here. A builder that cannot be
 * imported and exercised without a live component is a builder that needs
 * extracting into a pure function first.
 */
import { describe, it, expect } from 'vitest'
import { aiReviewSummarySchema } from '../server/lib/validators.js'
import {
    buildReviewSummaryPayload,
    MAX_MANIFEST_FILES,
    MAX_PATCH_FILES,
    MAX_PATCH_CHARS,
} from '../src/components/PRReview/hooks/useReviewAI.js'

const file = (over = {}) => ({
    filename: 'src/index.js',
    status: 'modified',
    additions: 10,
    deletions: 2,
    changes: 12,
    patch: '@@ -1,2 +1,10 @@\n+const x = 1',
    ...over,
})

const args = (over = {}) => ({
    files: [file()],
    owner: 'acme',
    repo: 'widgets',
    pullNumber: 273,
    title: 'Fix the thing',
    ...over,
})

describe('POST /api/ai/review-summary — client payload vs server schema', () => {
    it('accepts a typical payload', () => {
        const result = aiReviewSummarySchema.safeParse(buildReviewSummaryPayload(args()))
        expect(result.error?.issues).toBeUndefined()
        expect(result.success).toBe(true)
    })

    it('sends topFilePatches as objects the handler can map over, not a joined string', () => {
        // The handler does `topFilePatches.map(f => f.filename)`. A string would
        // silently iterate characters even if the schema let it through.
        const { topFilePatches } = buildReviewSummaryPayload(args())
        expect(Array.isArray(topFilePatches)).toBe(true)
        expect(topFilePatches[0]).toEqual({
            filename: 'src/index.js',
            patch: '@@ -1,2 +1,10 @@\n+const x = 1',
        })
    })

    it('carries repo and number so the audit trail is not recorded as undefined', () => {
        const { prMetadata } = buildReviewSummaryPayload(args())
        expect(prMetadata.repo).toBe('acme/widgets')
        expect(prMetadata.number).toBe(273)
        expect(prMetadata.title).toBe('Fix the thing')
    })

    it('stays valid for a PR with more files than the manifest cap', () => {
        const files = Array.from({ length: MAX_MANIFEST_FILES + 250 }, (_, i) =>
            file({ filename: `src/f${i}.js` })
        )
        const payload = buildReviewSummaryPayload(args({ files }))
        expect(payload.fileManifest).toHaveLength(MAX_MANIFEST_FILES)
        expect(payload.topFilePatches.length).toBeLessThanOrEqual(MAX_PATCH_FILES)
        expect(aiReviewSummarySchema.safeParse(payload).success).toBe(true)
    })

    it('stays valid when a single patch exceeds the per-patch cap', () => {
        const payload = buildReviewSummaryPayload(
            args({ files: [file({ patch: 'x'.repeat(MAX_PATCH_CHARS + 5000) })] })
        )
        expect(payload.topFilePatches[0].patch).toHaveLength(MAX_PATCH_CHARS)
        expect(aiReviewSummarySchema.safeParse(payload).success).toBe(true)
    })

    it('stays valid when no file carries a patch (binary-only PR)', () => {
        const payload = buildReviewSummaryPayload(
            args({ files: [file({ patch: undefined, filename: 'logo.png' })] })
        )
        expect(payload.topFilePatches).toEqual([])
        expect(aiReviewSummarySchema.safeParse(payload).success).toBe(true)
    })

    it('stays valid when GitHub omits additions/deletions', () => {
        const payload = buildReviewSummaryPayload(
            args({ files: [file({ additions: undefined, deletions: undefined })] })
        )
        expect(aiReviewSummarySchema.safeParse(payload).success).toBe(true)
    })
})
