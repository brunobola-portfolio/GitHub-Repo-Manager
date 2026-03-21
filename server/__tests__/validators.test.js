// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
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
    validate
} from '../lib/validators.js'

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
})

describe('aiIndexSchema', () => {
    it('accepts valid repo object', () => {
        const result = aiIndexSchema.safeParse({
            repo: { full_name: 'owner/repo' }
        })
        expect(result.success).toBe(true)
    })

    it('rejects missing full_name', () => {
        const result = aiIndexSchema.safeParse({
            repo: { name: 'repo' }
        })
        expect(result.success).toBe(false)
    })
})

describe('validate middleware', () => {
    it('passes validated data to next', () => {
        const middleware = validate(createRepoSchema)
        const req = { body: { name: 'test-repo' } }
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
        const next = vi.fn()

        middleware(req, res, next)
        expect(next).toHaveBeenCalled()
        expect(req.body.name).toBe('test-repo')
        expect(req.body.autoInit).toBe(true) // default applied
    })

    it('returns 400 on validation failure', () => {
        const middleware = validate(createRepoSchema)
        const req = { body: { name: '' } }
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
        const next = vi.fn()

        middleware(req, res, next)
        expect(next).not.toHaveBeenCalled()
        expect(res.status).toHaveBeenCalledWith(400)
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            error: 'Validation failed',
            code: 'VALIDATION_ERROR'
        }))
    })

    it('includes field-level error details', () => {
        const middleware = validate(createRepoSchema)
        const req = { body: { name: 'invalid name!' } }
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
        const next = vi.fn()

        middleware(req, res, next)
        const response = res.json.mock.calls[0][0]
        expect(response.details).toBeDefined()
        expect(response.details.length).toBeGreaterThan(0)
        expect(response.details[0]).toHaveProperty('field')
        expect(response.details[0]).toHaveProperty('message')
    })
})
