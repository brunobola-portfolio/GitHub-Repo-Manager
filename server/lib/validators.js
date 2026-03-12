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

const visibilitySchema = z.enum(['public', 'private']);

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

export const bulkTransferSchema = z.object({
    repos: z.array(z.string().min(1).max(200)).min(1).max(100),
    newOwner: z.string().min(1).max(39)
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
        content: z.string()
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
