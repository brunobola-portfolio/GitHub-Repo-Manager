// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
    createRepoSchema,
    bulkVisibilitySchema,
    bulkArchiveSchema,
    bulkDeleteSchema,
    bulkTransferSchema,
    checkConflictsSchema,
    teamCreateSchema,
    teamMemberSchema,
    teamRepoSchema,
    importSchema,
    azureImportSchema,
    aiChatSchema,
    aiIndexSchema,
    aiBatchIndexSchema,
    userAIConfigSchema,
} from '../lib/validators.js'

describe('aiBatchIndexSchema', () => {
    const repo = { id: 1, full_name: 'octocat/hello-world', name: 'hello-world' }

    it('accepts a valid batch of repos', () => {
        expect(aiBatchIndexSchema.safeParse({ repos: [repo, { ...repo, id: 2 }] }).success).toBe(true)
    })
    it('rejects a malformed full_name (path-traversal shape)', () => {
        const r = aiBatchIndexSchema.safeParse({ repos: [{ id: 1, full_name: '../../etc/passwd', name: 'x' }] })
        expect(r.success).toBe(false)
    })
    it('rejects a full_name that is not owner/repo', () => {
        expect(aiBatchIndexSchema.safeParse({ repos: [{ id: 1, full_name: 'notaslug' }] }).success).toBe(false)
    })
    it('accepts a dot-leading repo name (.github) but still rejects . and ..', () => {
        expect(aiBatchIndexSchema.safeParse({ repos: [{ id: 1, full_name: 'octocat/.github' }] }).success).toBe(true)
        expect(aiBatchIndexSchema.safeParse({ repos: [{ id: 1, full_name: 'octocat/.allstar' }] }).success).toBe(true)
        expect(aiBatchIndexSchema.safeParse({ repos: [{ id: 1, full_name: 'octocat/..' }] }).success).toBe(false)
        expect(aiBatchIndexSchema.safeParse({ repos: [{ id: 1, full_name: 'octocat/.' }] }).success).toBe(false)
    })
    it('requires the numeric id', () => {
        expect(aiBatchIndexSchema.safeParse({ repos: [{ full_name: 'o/r' }] }).success).toBe(false)
    })
    it('rejects an empty batch and a batch over the 10-repo cap', () => {
        expect(aiBatchIndexSchema.safeParse({ repos: [] }).success).toBe(false)
        const tooMany = Array.from({ length: 11 }, (_, i) => ({ ...repo, id: i + 1 }))
        expect(aiBatchIndexSchema.safeParse({ repos: tooMany }).success).toBe(false)
    })
})

describe('createRepoSchema', () => {
    it('accepts valid repo data', () => {
        const result = createRepoSchema.safeParse({
            name: 'my-repo',
            description: 'A test repo',
            isPrivate: true
        })
        expect(result.success).toBe(true)
        expect(result.data.name).toBe('my-repo')
    })

    it('applies defaults', () => {
        const result = createRepoSchema.safeParse({ name: 'my-repo' })
        expect(result.success).toBe(true)
        expect(result.data.description).toBe('')
        expect(result.data.isPrivate).toBe(false)
        expect(result.data.autoInit).toBe(true)
    })

    it('rejects empty name', () => {
        const result = createRepoSchema.safeParse({ name: '' })
        expect(result.success).toBe(false)
    })

    it('rejects invalid characters in name', () => {
        const result = createRepoSchema.safeParse({ name: 'my repo!' })
        expect(result.success).toBe(false)
    })

    it('accepts dots and underscores in name', () => {
        const result = createRepoSchema.safeParse({ name: 'my_repo.js' })
        expect(result.success).toBe(true)
    })

    it('accepts optional org', () => {
        const result = createRepoSchema.safeParse({ name: 'repo', org: 'my-org' })
        expect(result.success).toBe(true)
    })

    it('rejects org with invalid characters', () => {
        const result = createRepoSchema.safeParse({ name: 'repo', org: 'my_org' })
        expect(result.success).toBe(false)
    })
})

describe('bulkVisibilitySchema', () => {
    it('accepts valid data', () => {
        const result = bulkVisibilitySchema.safeParse({
            repos: ['owner/repo1', 'owner/repo2'],
            makePublic: true
        })
        expect(result.success).toBe(true)
    })

    it('rejects empty repos array', () => {
        const result = bulkVisibilitySchema.safeParse({ repos: [], makePublic: true })
        expect(result.success).toBe(false)
    })

    it('rejects missing makePublic', () => {
        const result = bulkVisibilitySchema.safeParse({ repos: ['a/b'] })
        expect(result.success).toBe(false)
    })

    it('limits repos to 100', () => {
        const repos = Array.from({ length: 101 }, (_, i) => `owner/repo${i}`)
        const result = bulkVisibilitySchema.safeParse({ repos, makePublic: true })
        expect(result.success).toBe(false)
    })
})

describe('bulkArchiveSchema', () => {
    it('defaults archive to true', () => {
        const result = bulkArchiveSchema.safeParse({ repos: ['o/r'] })
        expect(result.success).toBe(true)
        expect(result.data.archive).toBe(true)
    })
})

describe('bulkDeleteSchema', () => {
    it('accepts valid repos array', () => {
        const result = bulkDeleteSchema.safeParse({ repos: ['owner/repo'] })
        expect(result.success).toBe(true)
    })
})

describe('bulkTransferSchema', () => {
    it('requires toOrg', () => {
        const result = bulkTransferSchema.safeParse({ repos: ['a/b'] })
        expect(result.success).toBe(false)
    })

    it('accepts valid transfer data', () => {
        const result = bulkTransferSchema.safeParse({
            repos: ['a/b'],
            toOrg: 'target-org'
        })
        expect(result.success).toBe(true)
    })
})

describe('checkConflictsSchema', () => {
    it('accepts valid data', () => {
        const result = checkConflictsSchema.safeParse({
            repos: ['owner/repo1', 'owner/repo2'],
            targetOrg: 'my-org'
        })
        expect(result.success).toBe(true)
    })

    it('rejects missing targetOrg', () => {
        const result = checkConflictsSchema.safeParse({ repos: ['a/b'] })
        expect(result.success).toBe(false)
    })

    it('rejects empty repos', () => {
        const result = checkConflictsSchema.safeParse({ repos: [], targetOrg: 'org' })
        expect(result.success).toBe(false)
    })
})

describe('bulkTransferSchema with strategies', () => {
    it('accepts transfer without strategies (backward compat)', () => {
        const result = bulkTransferSchema.safeParse({
            repos: ['owner/repo'],
            toOrg: 'target-org'
        })
        expect(result.success).toBe(true)
    })

    it('accepts transfer with strategies', () => {
        const result = bulkTransferSchema.safeParse({
            repos: ['owner/repo'],
            toOrg: 'target-org',
            strategies: {
                'owner/repo': { action: 'replace' }
            }
        })
        expect(result.success).toBe(true)
    })

    it('accepts rename strategy with newName', () => {
        const result = bulkTransferSchema.safeParse({
            repos: ['owner/repo'],
            toOrg: 'target-org',
            strategies: {
                'owner/repo': { action: 'rename', newName: 'repo-2' }
            }
        })
        expect(result.success).toBe(true)
        expect(result.data.strategies['owner/repo'].newName).toBe('repo-2')
    })

    it('rejects invalid strategy action', () => {
        const result = bulkTransferSchema.safeParse({
            repos: ['owner/repo'],
            toOrg: 'target-org',
            strategies: {
                'owner/repo': { action: 'destroy' }
            }
        })
        expect(result.success).toBe(false)
    })
})

describe('teamCreateSchema', () => {
    it('accepts valid team data', () => {
        const result = teamCreateSchema.safeParse({ name: 'Frontend Team' })
        expect(result.success).toBe(true)
        expect(result.data.description).toBe('')
    })

    it('trims name', () => {
        const result = teamCreateSchema.safeParse({ name: '  My Team  ' })
        expect(result.success).toBe(true)
        expect(result.data.name).toBe('My Team')
    })

    it('rejects empty name', () => {
        const result = teamCreateSchema.safeParse({ name: '' })
        expect(result.success).toBe(false)
    })
})

describe('teamMemberSchema', () => {
    it('defaults role to member', () => {
        const result = teamMemberSchema.safeParse({ username: 'octocat' })
        expect(result.success).toBe(true)
        expect(result.data.role).toBe('member')
    })

    it('accepts admin role', () => {
        const result = teamMemberSchema.safeParse({ username: 'admin1', role: 'admin' })
        expect(result.success).toBe(true)
    })

    it('rejects invalid role', () => {
        const result = teamMemberSchema.safeParse({ username: 'user', role: 'owner' })
        expect(result.success).toBe(false)
    })
})

describe('teamRepoSchema', () => {
    it('accepts valid repoFullName', () => {
        const result = teamRepoSchema.safeParse({ repoFullName: 'owner/repo' })
        expect(result.success).toBe(true)
    })

    it('rejects empty repoFullName', () => {
        const result = teamRepoSchema.safeParse({ repoFullName: '' })
        expect(result.success).toBe(false)
    })
})

describe('importSchema', () => {
    it('accepts valid import data', () => {
        const result = importSchema.safeParse({
            sourceUrl: 'https://github.com/user/repo.git'
        })
        expect(result.success).toBe(true)
    })

    it('rejects invalid URL', () => {
        const result = importSchema.safeParse({ sourceUrl: 'not-a-url' })
        expect(result.success).toBe(false)
    })

    it('accepts optional fields', () => {
        const result = importSchema.safeParse({
            sourceUrl: 'https://github.com/user/repo.git',
            targetOrg: 'my-org',
            targetName: 'new-name',
            isPrivate: true
        })
        expect(result.success).toBe(true)
    })
})

describe('azureImportSchema', () => {
    it('accepts valid Azure import data', () => {
        const result = azureImportSchema.safeParse({
            azureOrg: 'myorg',
            azureProject: 'myproject',
            azureRepo: 'myrepo'
        })
        expect(result.success).toBe(true)
    })

    it('rejects missing required fields', () => {
        const result = azureImportSchema.safeParse({ azureOrg: 'org' })
        expect(result.success).toBe(false)
    })
})

describe('aiChatSchema', () => {
    it('accepts valid chat message', () => {
        const result = aiChatSchema.safeParse({
            message: 'Analyze this repo'
        })
        expect(result.success).toBe(true)
    })

    it('rejects empty message', () => {
        const result = aiChatSchema.safeParse({ message: '' })
        expect(result.success).toBe(false)
    })

    it('accepts history', () => {
        const result = aiChatSchema.safeParse({
            message: 'Follow up',
            history: [
                { role: 'user', content: 'Hi' },
                { role: 'assistant', content: 'Hello' }
            ]
        })
        expect(result.success).toBe(true)
    })

    it('rejects invalid history role', () => {
        const result = aiChatSchema.safeParse({
            message: 'Hi',
            history: [{ role: 'system', content: 'test' }]
        })
        expect(result.success).toBe(false)
    })

    it('accepts a normal-sized context object', () => {
        const result = aiChatSchema.safeParse({
            message: 'Hi',
            context: { errorCode: 'OVERSIZED_FILES', repo: 'acme/lib' }
        })
        expect(result.success).toBe(true)
    })

    it('rejects an oversized context payload', () => {
        const result = aiChatSchema.safeParse({
            message: 'Hi',
            context: { blob: 'x'.repeat(25000) }
        })
        expect(result.success).toBe(false)
    })
})

describe('aiIndexSchema', () => {
    it('accepts valid repo object', () => {
        const result = aiIndexSchema.safeParse({
            repo: { id: 12345, full_name: 'owner/repo' }
        })
        expect(result.success).toBe(true)
    })

    it('rejects missing full_name', () => {
        const result = aiIndexSchema.safeParse({
            repo: { id: 12345, name: 'repo' }
        })
        expect(result.success).toBe(false)
    })

    it('rejects missing id (PK in repo_metadata is NOT NULL)', () => {
        const result = aiIndexSchema.safeParse({
            repo: { full_name: 'owner/repo' }
        })
        expect(result.success).toBe(false)
    })
})

describe('userAIConfigSchema — featureOverrides model values', () => {
    it('accepts well-formed model ids across providers', () => {
        const result = userAIConfigSchema.safeParse({
            featureOverrides: {
                CHAT: 'gemini-2.5-pro',
                PR_REVIEW: 'claude-opus-4-5',
                SUGGEST: 'gpt-4o',
                EMBED: 'meta-llama/llama-3.1-70b-instruct', // OpenRouter style with a slash
            },
        })
        expect(result.success).toBe(true)
    })

    it('rejects an empty-string model value', () => {
        const result = userAIConfigSchema.safeParse({ featureOverrides: { CHAT: '' } })
        expect(result.success).toBe(false)
    })

    it('rejects a model value with whitespace or control characters', () => {
        expect(userAIConfigSchema.safeParse({ featureOverrides: { CHAT: 'gpt 4o' } }).success).toBe(false)
        expect(userAIConfigSchema.safeParse({ featureOverrides: { CHAT: 'gpt\n4o' } }).success).toBe(false)
    })

    it('rejects a model value with prompt-injection-y punctuation', () => {
        const result = userAIConfigSchema.safeParse({ featureOverrides: { CHAT: 'gpt-4o; rm -rf' } })
        expect(result.success).toBe(false)
    })

    it('still rejects a non-UPPER_SNAKE feature key', () => {
        const result = userAIConfigSchema.safeParse({ featureOverrides: { 'chat': 'gpt-4o' } })
        expect(result.success).toBe(false)
    })
})

// The legacy `validate()` middleware helper was removed when all routes
// migrated to `validateBody` / `validateQuery` / `validateParams` from
// `server/middleware/validate-request.js`. Coverage for that middleware
// lives in `validate-request.test.js`.
