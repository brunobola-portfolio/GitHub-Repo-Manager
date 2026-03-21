import { z } from 'zod';

// --- Shared schemas ---

const repoNameSchema = z.string().min(1).max(100).regex(
    /^[a-zA-Z0-9._-]+$/,
    'Repository name can only contain alphanumeric characters, hyphens, underscores, and dots'
);

const orgNameSchema = z.string().min(1).max(39).regex(
    /^[a-zA-Z0-9-]+$/,
    'Organization name can only contain alphanumeric characters and hyphens'
);

// --- Route-specific schemas ---

export const createRepoSchema = z.object({
    name: repoNameSchema,
    description: z.string().max(500).optional().default(''),
    isPrivate: z.boolean().optional().default(false),
    org: orgNameSchema.optional(),
    autoInit: z.boolean().optional().default(true),
    license: z.string().max(50).optional()
});

export const bulkVisibilitySchema = z.object({
    repos: z.array(z.string().min(1).max(200)).min(1).max(100),
    makePublic: z.boolean()
});

export const bulkArchiveSchema = z.object({
    repos: z.array(z.string().min(1).max(200)).min(1).max(100),
    archive: z.boolean().optional().default(true)
});

export const bulkDeleteSchema = z.object({
    repos: z.array(z.string().min(1).max(200)).min(1).max(100)
});

const strategySchema = z.object({
    action: z.enum(['transfer', 'replace', 'rename', 'skip']),
    newName: z.string().min(1).max(100).optional()
});

export const bulkTransferSchema = z.object({
    repos: z.array(z.string().min(1).max(200)).min(1).max(100),
    toOrg: z.string().min(1).max(39),
    strategies: z.record(z.string(), strategySchema).optional()
});

export const checkConflictsSchema = z.object({
    repos: z.array(z.string().min(1).max(200)).min(1).max(100),
    targetOrg: z.string().min(1).max(39)
});

export const bulkMirrorSchema = z.object({
    repos: z.array(z.string().min(1).max(200)).min(1).max(100),
    toOrg: z.string().min(1).max(39)
});

export const teamCreateSchema = z.object({
    name: z.string().min(1).max(100).trim(),
    description: z.string().max(500).optional().default('')
});

export const teamMemberSchema = z.object({
    username: z.string().min(1).max(39),
    role: z.enum(['admin', 'member']).optional().default('member')
});

export const teamRepoSchema = z.object({
    repoFullName: z.string().min(1).max(200)
});

export const importSchema = z.object({
    sourceUrl: z.string().url().max(2000),
    targetOrg: orgNameSchema.optional(),
    targetName: repoNameSchema.optional(),
    isPrivate: z.boolean().optional().default(false)
});

export const azureImportSchema = z.object({
    azureOrg: z.string().min(1).max(100),
    azureProject: z.string().min(1).max(100),
    azureRepo: z.string().min(1).max(100),
    targetOrg: orgNameSchema.optional(),
    targetName: repoNameSchema.optional(),
    isPrivate: z.boolean().optional().default(false)
});

export const aiChatSchema = z.object({
    message: z.string().min(1).max(10000),
    context: z.record(z.unknown()).optional(),
    history: z.array(z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(10000)
    })).max(50).optional()
});

export const aiIndexSchema = z.object({
    repo: z.object({
        full_name: z.string().min(1).max(200),
        name: z.string().optional(),
        description: z.string().max(5000).optional().nullable(),
        language: z.string().max(50).optional().nullable()
    })
});

export const repoUpdateSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    homepage: z.string().url().max(2000).optional().or(z.literal('')),
    private: z.boolean().optional(),
    has_issues: z.boolean().optional(),
    has_projects: z.boolean().optional(),
    has_wiki: z.boolean().optional(),
    default_branch: z.string().min(1).max(255).optional(),
    allow_squash_merge: z.boolean().optional(),
    allow_merge_commit: z.boolean().optional(),
    allow_rebase_merge: z.boolean().optional(),
    delete_branch_on_merge: z.boolean().optional()
}).refine(obj => Object.keys(obj).length > 0, { message: 'At least one field must be provided' });

export const topicsSchema = z.object({
    names: z.array(z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, 'Topics must be lowercase alphanumeric with hyphens')).max(20)
});

export const issueCreateSchema = z.object({
    title: z.string().min(1).max(256),
    body: z.string().max(65536).optional().default(''),
    labels: z.array(z.string().max(50)).optional(),
    assignees: z.array(z.string().max(39)).optional(),
    milestone: z.number().int().positive().optional().nullable()
});

export const prCreateSchema = z.object({
    title: z.string().min(1).max(256),
    body: z.string().max(65536).optional().default(''),
    head: z.string().min(1).max(255),
    base: z.string().min(1).max(255),
    draft: z.boolean().optional()
});

export const forkSchema = z.object({
    organization: z.string().min(1).max(39).regex(/^[a-zA-Z0-9-]+$/).optional(),
    name: z.string().min(1).max(100).optional(),
    default_branch_only: z.boolean().optional()
});

export const templateGenerateSchema = z.object({
    template_owner: z.string().min(1).max(39),
    template_repo: z.string().min(1).max(100),
    owner: z.string().min(1).max(39).optional(),
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional().default(''),
    include_all_branches: z.boolean().optional().default(false),
    private: z.boolean().optional().default(false)
});

export const releaseCreateSchema = z.object({
    tag_name: z.string().min(1).max(255),
    name: z.string().max(255).optional(),
    body: z.string().max(125000).optional().default(''),
    draft: z.boolean().optional().default(false),
    prerelease: z.boolean().optional().default(false),
    target_commitish: z.string().max(255).optional()
});

export const webhookCreateSchema = z.object({
    config: z.object({
        url: z.string().url().max(2000),
        content_type: z.enum(['json', 'form']).optional().default('json'),
        secret: z.string().max(255).optional()
    }),
    events: z.array(z.string().max(50)).min(1).optional().default(['push']),
    active: z.boolean().optional().default(true)
});

// --- Middleware factory ---

/**
 * Creates Express middleware that validates request body against a Zod schema.
 * On success, replaces req.body with the parsed (and sanitized) data.
 * On failure, returns 400 with structured validation errors.
 *
 * @param {z.ZodSchema} schema - The Zod schema to validate against
 * @returns {import('express').RequestHandler}
 */
export function validate(schema) {
    return (req, res, next) => {
        const result = schema.safeParse(req.body);
        if (!result.success) {
            const errors = result.error.issues.map(issue => ({
                field: issue.path.join('.'),
                message: issue.message
            }));
            return res.status(400).json({
                error: 'Validation failed',
                code: 'VALIDATION_ERROR',
                details: errors
            });
        }
        req.body = result.data;
        next();
    };
}
