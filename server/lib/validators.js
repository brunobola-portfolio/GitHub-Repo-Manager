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
    makePublic: z.boolean(),
    dryRun: z.boolean().optional().default(false)
});

export const bulkArchiveSchema = z.object({
    repos: z.array(z.string().min(1).max(200)).min(1).max(100),
    archive: z.boolean().optional().default(true),
    dryRun: z.boolean().optional().default(false)
});

export const bulkDeleteSchema = z.object({
    repos: z.array(z.string().min(1).max(200)).min(1).max(100),
    dryRun: z.boolean().optional().default(false)
});

const strategySchema = z.discriminatedUnion('action', [
    z.object({ action: z.literal('transfer') }),
    z.object({ action: z.literal('replace') }),
    z.object({ action: z.literal('rename'), newName: z.string().min(1).max(100) }),
    z.object({ action: z.literal('skip') }),
])

export const bulkTransferSchema = z.object({
    repos: z.array(z.string().min(1).max(200)).min(1).max(100),
    toOrg: z.string().min(1).max(39),
    strategies: z.record(z.string(), strategySchema).optional(),
    dryRun: z.boolean().optional().default(false)
});

export const checkConflictsSchema = z.object({
    repos: z.array(z.string().min(1).max(200)).min(1).max(100),
    targetOrg: z.string().min(1).max(39)
});

export const bulkMirrorSchema = z.object({
    repos: z.array(z.string().min(1).max(200)).min(1).max(100),
    toOrg: z.string().min(1).max(39),
    dryRun: z.boolean().optional().default(false)
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
    repoFullName: z.string().min(1).max(200),
    repoId: z.number().int().positive().optional()
});

// Basic-auth credentials for git clone of private mirrors. Both fields are
// optional so callers may submit an empty object or omit the field entirely.
const importCredentialsSchema = z.object({
    username: z.string().max(100).optional(),
    password: z.string().max(500).optional(),
    type: z.enum(['basic', 'pat']).optional(),
    token: z.string().max(500).optional(),
}).strict();

export const importSchema = z.object({
    sourceUrl: z.string().url().max(2000),
    targetOrg: orgNameSchema.optional(),
    targetName: repoNameSchema.optional(),
    // Both kept for backwards compatibility — callers may send either name.
    // The route prefers `makePrivate` and falls back to `isPrivate`.
    makePrivate: z.boolean().optional(),
    isPrivate: z.boolean().optional(),
    description: z.string().max(500).optional(),
    credentials: importCredentialsSchema.optional(),
});

export const importValidateUrlSchema = z.object({
    url: z.string().url().max(2000),
    credentials: importCredentialsSchema.optional(),
});

export const importCheckDuplicatesSchema = z.object({
    repos: z.array(z.string().min(1).max(200)).min(1).max(100),
    // Optional: when omitted, the server resolves to the authenticated user's
    // login. The frontend used to send the Azure org name as a fallback,
    // which caused the check to always return "no conflict" because the
    // Azure org name rarely matches a GitHub org.
    targetOwner: z.string().min(1).max(100).optional(),
});

export const azureImportSchema = z.object({
    azureOrg: z.string().min(1).max(100),
    azureProject: z.string().min(1).max(100),
    azureRepo: z.string().min(1).max(100),
    azurePat: z.string().min(1).max(500).optional(),
    targetOrg: orgNameSchema.optional(),
    targetName: repoNameSchema.optional(),
    makePrivate: z.boolean().optional(),
    isPrivate: z.boolean().optional(),
    description: z.string().max(500).optional(),
});

export const azureImportBatchSchema = z.object({
    azureOrg: z.string().min(1).max(100),
    azureProject: z.string().min(1).max(100),
    azurePat: z.string().min(1).max(500).optional(),
    targetOrg: orgNameSchema.optional(),
    makePrivate: z.boolean().optional(),
    repos: z.array(z.object({
        azureRepo: z.string().min(1).max(100),
        targetName: z.string().min(1).max(100).optional(),
    })).min(1).max(20),
});

// `hostname[:port]` — the deep allowlist/SSRF validation runs in
// azure-host-validator; this only bounds shape and length at the edge.
const azureHostSchema = z.string().max(253)
    .regex(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$/i, 'must be a hostname (optionally with :port)');

const tfvcPathSchema = z.string().min(2).max(400)
    .refine((p) => p.startsWith('$/'), { message: 'TFVC path must start with $/' });

// MUST match the camelCase keys of pickStrategies() in routes/import/azure/tfvc.js
// — kebab-case here would 400 the real values and let the admin force-strategy
// escape hatch silently fall through to the full cascade.
const tfvcStrategySchema = z.enum(['importApi', 'gitTfs', 'snapshot']);

export const azureTfvcImportSchema = z.object({
    azureHost: azureHostSchema.optional(),
    azureOrg: z.string().min(1).max(200),
    azureProject: z.string().min(1).max(200),
    tfvcPath: tfvcPathSchema,
    azurePat: z.string().min(1).max(500).optional(),
    savedCredentialId: z.union([z.number(), z.string().max(20)]).optional(),
    targetOrg: orgNameSchema.optional(),
    targetName: repoNameSchema.optional(),
    makePrivate: z.boolean().optional(),
    description: z.string().max(500).optional(),
    importHistory: z.boolean().optional(),
    forceStrategy: tfvcStrategySchema.optional(),
});

export const azureTfvcBatchSchema = z.object({
    azureHost: azureHostSchema.optional(),
    azureOrg: z.string().min(1).max(200),
    azureProject: z.string().min(1).max(200),
    azurePat: z.string().min(1).max(500).optional(),
    savedCredentialId: z.union([z.number(), z.string().max(20)]).optional(),
    targetOrg: orgNameSchema.optional(),
    makePrivate: z.boolean().optional(),
    importHistory: z.boolean().optional(),
    items: z.array(z.object({
        tfvcPath: tfvcPathSchema,
        targetName: z.string().min(1).max(100).optional(),
    })).min(1).max(20),
});

export const azureTfvcInPlaceSchema = z.object({
    azureHost: azureHostSchema.optional(),
    azureOrg: z.string().min(1).max(200),
    azureProject: z.string().min(1).max(200),
    tfvcPath: tfvcPathSchema,
    azurePat: z.string().min(1).max(500).optional(),
    savedCredentialId: z.union([z.number(), z.string().max(20)]).optional(),
    targetRepoName: z.string().min(1).max(100).optional(),
    targetProject: z.string().min(1).max(200).optional(),
    existingRepoId: z.string().min(1).max(100).optional(),
    importHistory: z.boolean().optional(),
});

export const aiChatSchema = z.object({
    message: z.string().min(1).max(10000),
    context: z.record(z.string(), z.unknown()).optional()
        .refine((v) => !v || JSON.stringify(v).length <= 20000, {
            message: 'context payload too large (max 20000 chars serialized)',
        }),
    history: z.array(z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(10000)
    })).max(50).optional()
});

export const attentionNarrativeSchema = z.object({
    repo: z.string().min(3).max(200).regex(/^[^/\s]+\/[^/\s]+$/, 'expected owner/name'),
    kind: z.enum(['failed_migration', 'stale_pinned', 'abandoned', 'hot']),
    signal: z.record(z.string(), z.unknown()).optional().default({}),
});

export const aiTranslateSearchSchema = z.object({
    q: z.string().min(1).max(500),
});

// ---------------------------------------------------------------------------
// Shared repo metadata schema for AI endpoints that take a repository object
// in the body (suggest, readme/enhance, quality-report). Whitelisted, length-
// capped fields only — anything outside the allow-list is stripped by Zod
// before the prompt builder ever sees it. This is the structural defence
// against prompt injection via large/exotic body payloads.
// ---------------------------------------------------------------------------

// owner/repo. The repo segment may start with a dot ('.github', '.allstar' are
// real, common GitHub repos) but must not be all dots ('.', '..' — path
// traversal). The owner segment is alphanumeric+hyphen (GitHub owners can't
// contain dots). No '/' inside either segment.
const repoFullNameRegex = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\/(?!\.+$)[a-zA-Z0-9._-]{1,100}$/;

export const aiRepoMetadataSchema = z.object({
    id: z.number().int().positive().optional(),
    name: z.string().min(1).max(100).optional(),
    full_name: z.string().min(3).max(200).regex(repoFullNameRegex).optional(),
    description: z.string().max(2000).nullable().optional(),
    language: z.string().max(50).nullable().optional(),
    topics: z.array(z.string().max(50)).max(50).optional(),
    license: z.union([
        z.string().max(100).nullable(),
        z.object({ name: z.string().max(100).optional(), spdx_id: z.string().max(50).optional() }).passthrough(),
    ]).optional(),
    default_branch: z.string().max(255).optional(),
    visibility: z.string().max(20).optional(),
    private: z.boolean().optional(),
    fork: z.boolean().optional(),
    archived: z.boolean().optional(),
    stargazers_count: z.number().int().nonnegative().optional(),
    forks_count: z.number().int().nonnegative().optional(),
    open_issues_count: z.number().int().nonnegative().optional(),
    size: z.number().int().nonnegative().optional(),
}).passthrough(); // allow extra unknown keys but those are NEVER read by handlers

export const aiSuggestSchema = z.object({
    repo: aiRepoMetadataSchema,
});

export const aiReadmeSchema = z.object({
    repo: aiRepoMetadataSchema.optional(),
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(2000).optional(),
    language: z.string().max(50).optional(),
    topics: z.union([
        z.array(z.string().max(50)).max(50),
        z.string().max(500),
    ]).optional(),
}).refine((v) => v.repo?.name || v.name, { message: 'repo.name or name is required' });

export const aiReadmeEnhanceSchema = z.object({
    repo: aiRepoMetadataSchema.refine((v) => !!v.full_name, { message: 'repo.full_name is required' }),
});

export const aiQualityReportSchema = z.object({
    repo: aiRepoMetadataSchema.refine((v) => !!v.full_name, { message: 'repo.full_name is required' }),
});

// README Studio — consolidated grounded improve endpoint (replaces the
// ungrounded /ai/readme + /ai/readme/enhance pair for new call sites; those
// two routes stay as-is for backward compatibility, see server/routes/ai/core.js).
export const aiReadmeStudioImproveSchema = z.object({
    repo: aiRepoMetadataSchema.refine((v) => !!v.full_name, { message: 'repo.full_name is required' }),
    mode: z.enum(['missing-sections', 'full-rewrite']).optional().default('missing-sections'),
    tone: z.enum(['professional', 'concise', 'enthusiastic']).optional().default('professional'),
    sections: z.array(z.string().max(50)).max(20).optional(),
    license: z.string().max(50).optional(),
    stackOverride: z.string().max(100).optional(),
    badges: z.boolean().optional().default(false),
}).strict();

// Deterministic (zero-AI-cost) README patch fallback — POST
// /ai/readme-studio/improve/deterministic. Reachable directly whenever the AI
// improve call is unavailable (no provider configured, a provider error, or
// the readmeGenPerMonth quota is exhausted — Addendum 6b.2,
// docs/specs/2026-07-18-community-wow-wave6.md §6b.2). No `tone`/`license`/
// `stackOverride`/`badges` knobs — there's no model in the loop to steer.
export const deterministicReadmeStudioSchema = z.object({
    repo: aiRepoMetadataSchema.refine((v) => !!v.full_name, { message: 'repo.full_name is required' }),
    mode: z.enum(['missing-sections', 'full-rewrite']).optional().default('missing-sections'),
}).strict();

// AI Diagram Generator — POST /api/ai/generate-diagram (server/routes/ai/diagrams.js).
// `diagramType` is enum-limited to 'architecture' for v1; sequence/flow are
// explicitly cut from scope (2026-07-18-community-wow-wave6.md) but the enum
// shape is written so adding them later is a one-line change, not a rework.
// `retry`/`failedSource`/`parseError` power the client's retry-once
// self-repair flow: the client re-posts the same request with the Mermaid
// text that failed to render client-side plus the parser error, and the
// server re-prompts for a corrected diagram. `retry` requests must carry a
// non-empty `failedSource` — there's nothing to repair otherwise.
export const aiGenerateDiagramSchema = z.object({
    repo: aiRepoMetadataSchema.refine((v) => !!v.full_name, { message: 'repo.full_name is required' }),
    diagramType: z.enum(['architecture']).optional().default('architecture'),
    focus: z.string().max(300).optional(),
    retry: z.boolean().optional().default(false),
    failedSource: z.string().max(8000).optional(),
    parseError: z.string().max(2000).optional(),
}).strict().refine((v) => !v.retry || !!v.failedSource, {
    message: 'retry requires failedSource',
    path: ['failedSource'],
});

// Deterministic (zero-AI-cost) diagram fallback — POST /ai/generate-diagram/deterministic.
// Reachable directly and used by the embed flow when the AI-generated Mermaid
// still fails to render after the one automatic self-repair attempt (Addendum
// 6b.1's "invalid mermaid after retry-once self-repair" edge case falls back
// to this rather than failing the embed).
export const deterministicDiagramSchema = z.object({
    repo: aiRepoMetadataSchema.refine((v) => !!v.full_name, { message: 'repo.full_name is required' }),
    diagramType: z.enum(['architecture']).optional().default('architecture'),
}).strict();

// Diagram embed (Addendum 6b.1, docs/specs/2026-07-18-community-wow-wave6.md
// §6b.1) — writes an already-generated diagram INTO the repo. Neither route
// calls a provider (the Mermaid/SVG the caller has was already generated via
// POST /ai/generate-diagram or the deterministic fallback above), so — like
// every other commit-only route in this codebase (community-health/commit-fix,
// agent-rules/commit) — these don't need requireScope('ai') / requireAI /
// quota gating; they're plain, auth-gated GitHub write actions.
const diagramEmbedTargetSchema = z.enum(['readme-mermaid', 'svg-file']);
const diagramEmbedPlacementSchema = z.enum(['top', 'after-intro', 'end', 'custom']);

export const embedDiagramPreviewSchema = z.object({
    repo: aiRepoMetadataSchema.refine((v) => !!v.full_name, { message: 'repo.full_name is required' }),
    diagramType: z.enum(['architecture']).optional().default('architecture'),
    target: diagramEmbedTargetSchema,
    mermaid: z.string().min(1).max(50_000).optional(),
    svg: z.string().min(1).max(600_000).optional(),
    placement: diagramEmbedPlacementSchema.optional().default('after-intro'),
    customAnchor: z.string().max(200).optional(),
    truncated: z.boolean().optional().default(false),
}).strict()
    .refine((v) => v.target !== 'readme-mermaid' || !!v.mermaid, { message: 'mermaid is required for target readme-mermaid', path: ['mermaid'] })
    .refine((v) => v.target !== 'svg-file' || !!v.svg, { message: 'svg is required for target svg-file', path: ['svg'] })
    .refine((v) => v.placement !== 'custom' || !!v.customAnchor, { message: 'customAnchor is required for placement custom', path: ['customAnchor'] });

// commit: each of readme/svg (whichever the target needs) is independently
// committed via commitOrOpenPR() — same sequential-per-file pattern
// agent-rules/commit already established for multi-file writes in this
// codebase, rather than inventing a new atomic multi-file commit primitive.
export const embedDiagramCommitSchema = z.object({
    repo: aiRepoMetadataSchema.refine((v) => !!v.full_name, { message: 'repo.full_name is required' }),
    diagramType: z.enum(['architecture']).optional().default('architecture'),
    target: diagramEmbedTargetSchema,
    readme: z.object({
        path: z.string().min(1).max(1024).optional().default('README.md'),
        content: z.string().min(1).max(2_000_000),
        commitMessage: z.string().min(1).max(10_000),
    }).optional(),
    svg: z.object({
        path: z.string().min(1).max(1024),
        content: z.string().min(1).max(600_000),
        commitMessage: z.string().min(1).max(10_000),
    }).optional(),
    mode: z.enum(['direct', 'pr']).optional().default('direct'),
}).strict()
    .refine((v) => v.target !== 'readme-mermaid' || !!v.readme, { message: 'readme is required for target readme-mermaid', path: ['readme'] })
    .refine((v) => v.target !== 'svg-file' || !!v.svg, { message: 'svg is required for target svg-file', path: ['svg'] });

// AI Image Generator (Wave 6c / R5) — POST /api/ai/generate-image
// (server/routes/ai/images.js). Grounded in repo name/description/language/
// topics; three fixed presets (social/hero/logo) rather than an arbitrary
// size. `promptExtras` is deliberately short and additive-only — a
// style/color-hint field appended to the fixed template, NOT a free-text
// prompt replacement (r5 §4.6: exposing a fully free-text override is out of
// scope for v1; the content-safety constraints are always appended AFTER
// this field server-side so they can't be overridden by user-supplied text).
export const aiGenerateImageSchema = z.object({
    repo: aiRepoMetadataSchema.refine((v) => !!v.full_name, { message: 'repo.full_name is required' }),
    preset: z.enum(['social', 'hero', 'logo']),
    promptExtras: z.string().max(150).optional(),
}).strict();

// Commit a previously generated, client-echoed image into the repo — the
// generate/commit split mirrors agent-rules and the diagram embed flow
// (preview-before-commit, never re-generate server-side). The destination
// path is ALWAYS derived server-side from `preset` (IMAGE_PRESETS in
// server/routes/ai/images.js) — there is no `path` field here at all, which
// is the hardening: the client cannot request an arbitrary write location,
// mirroring the diagram embed-commit's `svg.path === svgPathFor(diagramType)`
// defence-in-depth check.
//
// `base64` is capped at ~4 MB of decoded binary (~5.6 MB of base64 text) —
// generous for a PNG at these presets' resolutions while still bounding a
// single request's payload (same reasoning as `base64Content` below, scaled
// up for images vs. the 2 MB text-file cap).
const imageBase64Content = z.string()
    .min(1)
    .max(5_600_000)
    .regex(/^[A-Za-z0-9+/=\s]+$/, 'base64 must be base64-encoded');

export const commitImageSchema = z.object({
    repo: aiRepoMetadataSchema.refine((v) => !!v.full_name, { message: 'repo.full_name is required' }),
    preset: z.enum(['social', 'hero', 'logo']),
    base64: imageBase64Content,
    commitMessage: z.string().min(1).max(500).optional(),
    mode: z.enum(['direct', 'pr']).optional().default('direct'),
}).strict();

// Agent Rules Generator — POST /:owner/:repo/agent-rules/generate and
// /agent-rules/commit (server/routes/repos/actions-community.js). `sections`
// mirrors server/lib/ai-features/agent-rules.js's SECTION_KEYS; unknown keys
// are stripped rather than rejected so the section toggle set can grow
// without a schema break.
const agentRulesSectionsSchema = z.object({
    setup: z.boolean().optional(),
    codeStyle: z.boolean().optional(),
    testing: z.boolean().optional(),
    devEnv: z.boolean().optional(),
    prInstructions: z.boolean().optional(),
    security: z.boolean().optional(),
    repoLayout: z.boolean().optional(),
}).strip();

export const agentRulesGenerateSchema = z.object({
    targetFiles: z.array(z.enum(['AGENTS.md', 'CLAUDE.md'])).min(1).max(2).optional().default(['AGENTS.md']),
    mode: z.enum(['create', 'refresh']).optional().default('create'),
    sections: agentRulesSectionsSchema.optional().default({}),
    strictness: z.enum(['concise', 'detailed']).optional().default('concise'),
}).strict();

// commit: one entry per target file (1-2), each independently committed via
// commitOrOpenPR() — see server/lib/ai-features/community-health-fix.js.
export const agentRulesCommitSchema = z.object({
    files: z.array(z.object({
        filePath: z.enum(['AGENTS.md', 'CLAUDE.md']),
        content: z.string().min(1).max(2_000_000),
        commitMessage: z.string().min(1).max(10_000),
    })).min(1).max(2),
    mode: z.enum(['direct', 'pr']).optional().default('direct'),
}).strict();

// Security Posture AI summary — POST /:owner/:repo/security/summary
// (server/routes/v1/repos-security.js). The client submits back the SAME 10
// check results the GET /security response just computed server-side — this
// is the honesty-critical whitelist that keeps raw alert bodies (which could
// contain secret/PII fragments) out of the AI prompt: only id/label/status/
// severity survive `.strip()`, and `checks` is capped at 10 entries (the
// deterministic report card never produces more).
const SECURITY_POSTURE_CHECK_IDS = [
    'branch_protection_review', 'branch_protection_force_push', 'alerts_clear',
    'secret_scanning', 'secret_scanning_push_protection', 'dependabot_security_updates',
    'code_scanning', 'security_md', 'workflow_permissions', 'org_two_factor',
];

const securityPostureCheckSchema = z.object({
    id: z.enum(SECURITY_POSTURE_CHECK_IDS),
    label: z.string().min(1).max(200),
    status: z.enum(['pass', 'fail', 'unknown', 'not_applicable', 'informational']),
    severity: z.enum(['critical', 'high', 'medium', 'low', 'informational']).nullable().optional(),
}).strip();

export const securityPostureSummarySchema = z.object({
    repo: z.object({
        full_name: z.string().min(3).max(200).regex(repoFullNameRegex),
        private: z.boolean().optional(),
    }).strip(),
    checks: z.array(securityPostureCheckSchema).min(1).max(10),
}).strict();

// ---------------------------------------------------------------------------
// Dev Toolkit endpoints (refine / chat-refine / analyze-context / generate-*)
// ---------------------------------------------------------------------------

export const REFINE_INSTRUCTIONS = [
    'shorter', 'more_detail', 'add_body', 'breaking_change',
    'more_cases', 'edge_cases', 'e2e_focus', 'architecture_notes', 'more_context',
];

export const aiRefineSchema = z.object({
    original_content: z.string().min(1).max(20000),
    original_diff: z.string().max(20000).optional(),
    instruction: z.enum(REFINE_INSTRUCTIONS),
    content_type: z.enum(['commit', 'pr_summary', 'pr_test_plan']).optional(),
});

export const aiChatRefineSchema = z.object({
    message: z.string().min(1).max(4000),
    current_output: z.string().max(20000).optional(),
    original_diff: z.string().max(20000).optional(),
    content_type: z.enum(['commit', 'pr_summary', 'pr_test_plan', 'review_qa']).optional(),
    history: z.array(z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(8000),
    })).max(20).optional(),
});

export const aiAnalyzeContextSchema = z.object({
    repo: z.string().min(3).max(200).regex(repoFullNameRegex),
    diff_summary: z.object({
        files: z.number().int().nonnegative().max(10000),
        additions: z.number().int().nonnegative().max(10_000_000),
        deletions: z.number().int().nonnegative().max(10_000_000),
    }),
    commits: z.array(z.object({
        message: z.string().max(2000),
    })).max(200).optional(),
    file_list: z.array(z.string().max(500)).max(500).optional(),
});

export const aiGenerateCommitSchema = z.object({
    diff: z.string().min(1).max(60000),
    format: z.enum(['conventional', 'gitmoji', 'descriptive', 'repo-convention']).optional(),
    repo_style: z.object({
        pattern: z.string().max(200).optional(),
        examples: z.array(z.string().max(200)).max(20).optional(),
    }).optional(),
    repo_context: z.object({
        name: z.string().max(200).optional(),
        description: z.string().max(500).optional(),
    }).optional(),
});

export const aiGeneratePrSchema = z.object({
    commits: z.array(z.object({
        message: z.string().min(1).max(2000),
    })).min(1).max(200),
    diff_summary: z.object({
        files: z.array(z.object({
            filename: z.string().max(500),
            additions: z.number().int().nonnegative().max(10_000_000).optional(),
            deletions: z.number().int().nonnegative().max(10_000_000).optional(),
        })).max(500).optional(),
    }).optional(),
    top_patches: z.string().max(60000).optional(),
    template: z.string().max(8000).optional(),
    repo_context: z.object({
        name: z.string().max(200).optional(),
    }).optional(),
});

export const aiReviewSummarySchema = z.object({
    fileManifest: z.array(z.object({
        filename: z.string().max(500),
        status: z.string().max(50).optional(),
        additions: z.number().int().nonnegative().max(10_000_000).optional(),
        deletions: z.number().int().nonnegative().max(10_000_000).optional(),
    })).max(500),
    topFilePatches: z.array(z.object({
        filename: z.string().max(500),
        patch: z.string().max(120000).optional(),
    })).max(50).optional(),
    prMetadata: z.object({
        title: z.string().max(500).optional(),
        number: z.number().int().nonnegative().optional(),
        repo: z.string().max(200).optional(),
        additions: z.number().int().nonnegative().max(10_000_000).optional(),
        deletions: z.number().int().nonnegative().max(10_000_000).optional(),
    }),
});

// Shared shape for a repo object handed to the indexer. `id` is the GitHub
// numeric repo ID and the primary key in repo_metadata / repo_embeddings
// (NOT NULL) — without it Zod strips the field and the INSERT throws against
// the NOT NULL column. `full_name` is regex-validated (not just length-bounded)
// because the index handlers splice it straight into GitHub API paths.
const aiIndexRepoSchema = z.object({
    id: z.number().int().positive(),
    full_name: z.string().min(3).max(200).regex(repoFullNameRegex),
    name: z.string().optional(),
    description: z.string().max(5000).optional().nullable(),
    language: z.string().max(50).optional().nullable()
});

export const aiIndexSchema = z.object({
    repo: aiIndexRepoSchema
});

// Batch variant: same per-repo shape, bounded to the handler's 10-repo cap so
// every element is shape- and length-validated before any GitHub fetch.
export const aiBatchIndexSchema = z.object({
    repos: z.array(aiIndexRepoSchema).min(1).max(10)
});

export const aiIssueToPlanSchema = z.object({
    repoFullName: z.string().min(1).max(200).regex(
        /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}\/[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,99}$/,
        'repoFullName must be "owner/repo"'
    ),
    issueNumber: z.coerce.number().int().positive().max(1_000_000),
    extraContext: z.string().max(2000).optional(),
});

export const repoUpdateSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    homepage: z.string().url().max(2000).optional().or(z.literal('')),
    private: z.boolean().optional(),
    archived: z.boolean().optional(),
    has_issues: z.boolean().optional(),
    has_projects: z.boolean().optional(),
    has_wiki: z.boolean().optional(),
    allow_forking: z.boolean().optional(),
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

// --- Migration Plan Schemas ---

export const createPlanSchema = z.object({
    source: z.object({
        type: z.literal('azure'),
        host: z.string().min(1).max(253).default('dev.azure.com'),
        org: z.string().min(1).max(100),
        project: z.string().min(1).max(100),
        pat: z.string().min(1).optional()
    }),
    targetOrg: z.string().max(39).optional(),
    tasks: z.array(z.discriminatedUnion('type', [
        z.object({
            type: z.literal('repo'),
            sourceRef: z.string().min(1),
            targetRef: z.string().min(1).max(140),
            config: z.object({
                makePrivate: z.boolean().default(true),
                description: z.string().max(350).default(''),
                rollbackPolicy: z.enum(['delete', 'keep-empty']).default('delete'),
                timeout: z.number().min(60000).max(3600000).default(1800000),
                sizeStrategy: z.enum(['exclude', 'lfs-migrate']).optional(),
                // Destructive "Replace" intent from the wizard. Zod strips
                // unknown keys, so this MUST be declared or the engine never
                // sees it and the migration fails on the existing repo.
                onConflict: z.enum(['fail', 'replace']).optional()
            }).default({})
        }),
        z.object({
            type: z.literal('repo-tfvc'),
            sourceRef: z.string().min(1),
            targetRef: z.string().min(1).max(140),
            config: z.object({
                makePrivate: z.boolean().default(true),
                description: z.string().max(350).default(''),
                rollbackPolicy: z.enum(['delete', 'keep-empty']).default('delete'),
                timeout: z.number().min(60000).max(3600000).default(1800000),
                sizeStrategy: z.enum(['exclude', 'lfs-migrate']).optional(),
                onConflict: z.enum(['fail', 'replace']).optional(),
                // TFVC in-place keys read by the engine (migration-engine.js
                // repo-tfvc case). Must be declared or zod strips them and the
                // wizard's in-place choice silently falls back to GitHub push.
                inPlace: z.boolean().optional(),
                targetProject: z.string().max(100).optional(),
                existingRepoId: z.string().max(200).optional()
            }).default({})
        }),
        z.object({
            type: z.literal('work-items'),
            sourceRef: z.string().min(1),
            targetRef: z.string().min(1),
            config: z.object({
                types: z.array(z.string()).min(1),
                includeComments: z.boolean().default(true),
                includeAttachments: z.boolean().default(true),
                includeHistory: z.boolean().default(false),
                createProjectBoard: z.boolean().default(false),
                labelMapping: z.record(z.string(), z.string()).default({})
            })
        }),
        z.object({
            type: z.literal('wiki'),
            sourceRef: z.string().min(1),
            targetRef: z.string().min(1),
            config: z.object({
                destination: z.enum(['wiki', 'docs']),
                createPR: z.boolean().default(true),
                branch: z.string().default('docs/wiki-migration')
            })
        })
    ])).min(1).max(60),
    schedule: z.object({
        mode: z.enum(['now', 'scheduled']).default('now'),
        scheduledAt: z.string().datetime().optional(),
        isDryRun: z.boolean().default(false)
    }).default({ mode: 'now', isDryRun: false }),
    taggingPolicy: z.object({
        enabled: z.boolean().default(true),
        writeSource: z.boolean().default(true),
        writeDestination: z.boolean().default(true),
        writeGitTag: z.boolean().default(true),
        hideSourceName: z.boolean().default(false)
    }).optional()
});

export const updatePlanSchema = createPlanSchema.partial();

export const migrationSizeStrategySchema = z.object({
    repoId: z.string().min(1).max(200),
    size: z.number().int().nonnegative(),
    hasLfsMarker: z.boolean().default(false),
    branches: z.number().int().nonnegative().default(0),
    lastCommitDate: z.string().datetime().nullish(),
});

export const migrationDescriptionSchema = z.object({
    repoId: z.string().min(1).max(200),
    repoName: z.string().min(1).max(100),
    language: z.string().max(50).nullish(),
    size: z.number().int().nonnegative().default(0),
    branches: z.number().int().nonnegative().default(0),
    hasLfsMarker: z.boolean().default(false),
    lastCommitDate: z.string().datetime().nullish(),
    source: z.object({
        org: z.string().min(1).max(100),
        project: z.string().min(1).max(100),
        isTfvc: z.boolean().default(false),
        tfvcPath: z.string().max(500).nullish(),
    }),
});

// --- AI Deep Review prompt presets (Prompt Studio, slices 1b + 5) ---
//
// Slice 1b shipped user/repo-scoped presets; slice 5 adds 'org' scope for
// org-shared presets visible to every active member of the GitHub org.
// `scopeTarget` is required for both repo and org scope:
//   - repo scope: must match GitHub's `owner/repo` shape
//   - org scope: must match GitHub's org login shape (alphanumeric + `.`/`-`/`_`,
//     length ≤ 39, no leading/trailing punctuation)
// We keep regex bounds tight so the value can be safely interpolated into
// store WHERE clauses (which already use parameter binding, but defence-in-
// depth is cheap).
const PRESET_SEVERITY_FLOORS = ['info', 'suggestion', 'warning', 'critical'];
const PRESET_SCOPES = ['user', 'repo', 'org'];
const REPO_FULL_NAME_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?\/[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;
export const ORG_LOGIN_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;
const PRESET_KEY_RE = /^[a-z0-9_-]{1,40}$/;

export const promptPresetCreateSchema = z.object({
    scope: z.enum(PRESET_SCOPES),
    // scopeTarget can hold either an org login OR an `owner/repo` string,
    // so we relax the regex here and gate per-scope shape inside .refine().
    scopeTarget: z.string().max(140).nullable().optional(),
    presetKey: z.string().regex(PRESET_KEY_RE),
    name: z.string().min(1).max(100),
    systemPrompt: z.string().min(1).max(8000),
    pathRules: z.array(z.object({
        glob: z.string().min(1).max(200),
        extraPrompt: z.string().min(1).max(2000),
    })).max(20).optional(),
    severityFloor: z.enum(PRESET_SEVERITY_FLOORS).nullable().optional(),
}).refine((v) => {
    if (v.scope === 'repo') {
        return !!(v.scopeTarget && REPO_FULL_NAME_RE.test(v.scopeTarget));
    }
    if (v.scope === 'org') {
        return !!(v.scopeTarget && v.scopeTarget.length <= 39 && ORG_LOGIN_RE.test(v.scopeTarget));
    }
    return true;
}, {
    message: 'scopeTarget required for scope=repo (owner/repo) or scope=org (org login)',
    path: ['scopeTarget'],
});

export const promptPresetUpdateSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    systemPrompt: z.string().min(1).max(8000).optional(),
    pathRules: z.array(z.object({
        glob: z.string().min(1).max(200),
        extraPrompt: z.string().min(1).max(2000),
    })).max(20).optional(),
    severityFloor: z.enum(PRESET_SEVERITY_FLOORS).nullable().optional(),
});

// --- BYOK / User AI Config Schemas ---

export const userAIConfigSchema = z.object({
    completionProvider: z.enum(['gemini', 'anthropic', 'openai', 'openrouter', 'local']).nullable().optional(),
    completionModel: z.string().max(120).nullable().optional(),
    completionApiKey: z.string().min(1).max(2000).nullable().optional(),
    completionEndpointUrl: z.string().url().max(500).nullable().optional(),
    embeddingProvider: z.enum(['gemini', 'openai', 'local']).nullable().optional(),
    embeddingModel: z.string().max(120).nullable().optional(),
    embeddingApiKey: z.string().min(1).max(2000).nullable().optional(),
    embeddingEndpointUrl: z.string().url().max(500).nullable().optional(),
    featureOverrides: z.record(
        z.string().regex(/^[A-Z_]+$/, 'Feature key must be UPPER_SNAKE_CASE'),
        // Model id: non-empty, bounded, and restricted to the characters real
        // provider model ids use (alnum plus . _ - : and / for OpenRouter
        // "vendor/model"). Rejects empty strings, whitespace, control chars and
        // injection-y punctuation before the value ever reaches a provider SDK.
        z.string().min(1).max(120).regex(/^[A-Za-z0-9._:/-]+$/, 'Invalid model id')
    ).nullable().optional(),
});

export const testAIConfigSchema = z.object({
    kind: z.enum(['completion', 'embedding']),
});

// --- GitHub issues / pulls / orgs / branches mutations (P1 hardening) ---
//
// These schemas whitelist what we accept on the proxy routes — anything
// outside the allow-list is dropped before the call hits GitHub. We keep them
// permissive on string-length so legitimate edits (e.g. 50 KB issue bodies)
// still pass, but reject unknown keys to stop unintended fields from being
// forwarded.

const issueState = z.enum(['open', 'closed']);
const stateReason = z.enum(['completed', 'not_planned', 'reopened']);

export const issueUpdateSchema = z.object({
    title: z.string().min(1).max(256).optional(),
    body: z.string().max(65_536).nullable().optional(),
    state: issueState.optional(),
    state_reason: stateReason.nullable().optional(),
    labels: z.array(z.string().min(1).max(50)).max(100).optional(),
    assignees: z.array(z.string().min(1).max(39)).max(10).optional(),
    milestone: z.number().int().positive().nullable().optional(),
}).strict();

export const issueCommentSchema = z.object({
    body: z.string().min(1).max(65_536),
}).strict();

export const issueLabelsSchema = z.object({
    labels: z.array(z.string().min(1).max(50)).min(1).max(100),
}).strict();

export const repoLabelCreateSchema = z.object({
    name: z.string().min(1).max(50),
    color: z.string().regex(/^[0-9a-fA-F]{6}$/, 'Color must be a 6-char hex without #').optional(),
    description: z.string().max(100).optional(),
}).strict();

export const prUpdateSchema = z.object({
    title: z.string().min(1).max(256).optional(),
    body: z.string().max(65_536).nullable().optional(),
    state: issueState.optional(),
    base: z.string().min(1).max(255).optional(),
    maintainer_can_modify: z.boolean().optional(),
}).strict();

// --- PR write-back: merge / review-comment / reply / review submit ---
//
// These four endpoints previously shipped with `requireAuth` but read
// straight off `req.body` with no (or ad-hoc) validation. The schemas below
// whitelist exactly what each handler forwards to GitHub, matching the shapes
// the frontend actually sends (mergePull / DiffPanel onAddComment /
// submitReview / replyToComment) plus GitHub-documented optionals. `.strict()`
// at the envelope level rejects unknown-shape input with a 400 via
// `validateBody`'s `{ error, code: 'validation_failed' }` envelope.

// Diff side ('LEFT' | 'RIGHT'), accepted case-insensitively because
// @git-diff-view and older callers can emit lowercase; normalised to GitHub's
// uppercase enum before it reaches the API. Non-string input falls through to
// the enum, which rejects it with a 400.
const reviewCommentSide = z.preprocess(
    (v) => (typeof v === 'string' ? v.toUpperCase() : v),
    z.enum(['LEFT', 'RIGHT']),
);

export const prMergeSchema = z.object({
    merge_method: z.enum(['merge', 'squash', 'rebase']).optional().default('merge'),
    commit_title: z.string().max(1024).optional(),
    commit_message: z.string().max(65_536).optional(),
    // GitHub-documented optional: the head SHA the PR must match to merge.
    sha: z.string().min(1).max(64).optional(),
}).strict();

export const prReviewCommentSchema = z.object({
    body: z.string().min(1).max(65_536),
    commit_id: z.string().min(1).max(64),
    path: z.string().min(1).max(1024),
    line: z.number().int().positive().max(1_000_000).optional(),
    side: reviewCommentSide.optional(),
    start_line: z.number().int().positive().max(1_000_000).optional(),
    start_side: reviewCommentSide.optional(),
    subject_type: z.enum(['line', 'file']).optional(),
    in_reply_to: z.number().int().positive().optional(),
}).strict();

export const prReviewReplySchema = z.object({
    body: z.string().min(1).max(65_536),
}).strict();

// Per-comment shape inside a review submission. NON-strict on purpose: the
// review composer can attach UI-only annotation keys (severity, suggestion)
// that GitHub does not accept — zod strips them here so they never reach the
// API, without 400-ing the whole review over a harmless extra field.
const prReviewInlineComment = z.object({
    path: z.string().min(1).max(1024),
    body: z.string().min(1).max(65_536),
    line: z.number().int().positive().max(1_000_000).optional(),
    side: reviewCommentSide.optional(),
    start_line: z.number().int().positive().max(1_000_000).optional(),
    start_side: reviewCommentSide.optional(),
    position: z.number().int().nonnegative().optional(),
});

export const prReviewSubmitSchema = z.object({
    event: z.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']),
    // Optional — APPROVE may carry no body; the frontend sends '' or undefined.
    body: z.string().max(65_536).optional(),
    // The PR head SHA, passed straight through by the frontend; it can be null
    // when the head hasn't loaded yet, so allow null as well as absent.
    commit_id: z.string().min(1).max(64).nullable().optional(),
    comments: z.array(prReviewInlineComment).max(200).optional(),
}).strict();

export const branchCreateSchema = z.object({
    // Git ref name rules (simplified subset of `git check-ref-format`):
    //   - no leading '-' (would be parsed as a CLI flag downstream)
    //   - no '..' (parent-dir escape)
    //   - no '//' (consecutive slashes)
    //   - no '@{' (reflog syntax)
    //   - no whitespace, no control chars, none of `~ ^ : ? * \ [` (git-forbidden)
    name: z.string()
        .min(1).max(255)
        .refine((v) => !v.startsWith('-'), 'Invalid git ref name')
        .refine((v) => !v.includes('..'), 'Invalid git ref name')
        .refine((v) => !v.includes('//'), 'Invalid git ref name')
        .refine((v) => !v.includes('@{'), 'Invalid git ref name')
        // No whitespace, no git-forbidden punctuation (~ ^ : ? * \ [).
        .refine((v) => !/[\s~^:?*[]/.test(v), 'Invalid git ref name')
        // No ASCII control chars / DEL — done char-by-char to avoid a
        // regex literal containing control bytes.
        .refine((v) => {
            for (let i = 0; i < v.length; i++) {
                const c = v.charCodeAt(i);
                if (c < 0x20 || c === 0x7f) return false;
            }
            return true;
        }, 'Invalid git ref name'),
    from: z.string().min(1).max(255).optional(),
}).strict();

// `branch_protection` matches GitHub's API surface. We keep it permissive on
// the deeply-nested fields because GitHub validates them server-side; the
// outer object is whitelisted to stop unknown keys from being forwarded.
export const branchProtectionSchema = z.object({
    required_status_checks: z.object({
        strict: z.boolean().optional(),
        contexts: z.array(z.string()).optional(),
        checks: z.array(z.object({
            context: z.string(),
            app_id: z.number().nullable().optional(),
        })).optional(),
    }).nullable().optional(),
    enforce_admins: z.boolean().nullable().optional(),
    required_pull_request_reviews: z.object({
        required_approving_review_count: z.number().int().min(0).max(6).optional(),
        dismiss_stale_reviews: z.boolean().optional(),
        require_code_owner_reviews: z.boolean().optional(),
        require_last_push_approval: z.boolean().optional(),
        bypass_pull_request_allowances: z.unknown().optional(),
        dismissal_restrictions: z.unknown().optional(),
    }).nullable().optional(),
    restrictions: z.unknown().nullable().optional(),
    required_linear_history: z.boolean().optional(),
    allow_force_pushes: z.boolean().nullable().optional(),
    allow_deletions: z.boolean().optional(),
    required_conversation_resolution: z.boolean().optional(),
    lock_branch: z.boolean().optional(),
    allow_fork_syncing: z.boolean().optional(),
    block_creations: z.boolean().optional(),
}).strict();

export const orgRepoCreateSchema = z.object({
    name: repoNameSchema,
    description: z.string().max(500).optional(),
    private: z.boolean().optional(),
    auto_init: z.boolean().optional(),
}).strict();

// Permission allow-list shared by collaborator routes (single source of truth).
export const collaboratorPermissionEnum = z.enum(['pull', 'triage', 'push', 'maintain', 'admin']);

export const collaboratorAddSchema = z.object({
    permission: collaboratorPermissionEnum.optional().default('push'),
}).strict();

// Client error reporter — bounded fields, drops unknown keys.
export const clientErrorSchema = z.object({
    message: z.string().max(1000),
    stack: z.string().max(8000).optional(),
    url: z.string().max(2000).optional(),
    userAgent: z.string().max(500).optional(),
    componentStack: z.string().max(8000).optional(),
    context: z.record(z.string(), z.unknown()).optional(),
}).strict();

// --- Repository contents (create/update/delete file) ---
//
// The GitHub Contents API takes the file `path` in the URL (our routes read it
// from the query string and validate it separately via `validatePath`), so the
// body carries only commit metadata + the payload. There is no frontend caller
// for these write endpoints today; the shapes below match GitHub's documented
// Contents API and exactly what the handlers forward to githubApi
// (`{ message, content, branch, sha }` for PUT, `{ message, sha, branch }` for
// DELETE). `content` is base64 and capped so a single request can't stream an
// unbounded blob through the proxy (~2 MB of binary ≈ 2.8 MB of base64 text).
const base64Content = z.string()
    .min(1)
    .max(2_800_000)
    .regex(/^[A-Za-z0-9+/=\s]+$/, 'content must be base64-encoded');

export const contentsCreateUpdateSchema = z.object({
    message: z.string().min(1).max(10_000),
    content: base64Content,
    // Present = update the existing blob; absent = create a new file.
    sha: z.string().min(1).max(64).optional(),
    branch: z.string().min(1).max(255).optional(),
}).strict();

export const contentsDeleteSchema = z.object({
    message: z.string().min(1).max(10_000),
    // GitHub requires the blob sha to delete.
    sha: z.string().min(1).max(64),
    branch: z.string().min(1).max(255).optional(),
}).strict();

// --- Issue labels / assignees (parity endpoints) ---
//
// Replace-labels intentionally allows an EMPTY array — "clear all labels" is a
// legitimate flow (IssueSidebar sends the full selected label set, which may be
// empty). This is why we DON'T reuse `issueLabelsSchema` (which is `.min(1)`,
// for the add-labels endpoint). Items are GitHub label names.
export const issueLabelsReplaceSchema = z.object({
    labels: z.array(z.string().min(1).max(50)).max(100),
}).strict();

// Add / remove assignees share one shape. Each item is a GitHub login (≤ 39
// chars). Empty is allowed (the prior inline check only required an array); the
// frontend always sends exactly one login.
export const issueAssigneesSchema = z.object({
    assignees: z.array(z.string().min(1).max(39)).max(25),
}).strict();

// --- Webhook update (PATCH /hooks/:id) ---
//
// No frontend caller today (the UI creates / deletes / pings hooks but has no
// edit form). Shape mirrors GitHub's "Update a repository webhook" API and
// exactly what the handler forwards: config + events + add/remove_events +
// active. All optional so an effective no-op PATCH (`{}`) is accepted; unknown
// keys are rejected so nothing unexpected is forwarded to GitHub.
export const webhookUpdateSchema = z.object({
    config: z.object({
        url: z.string().url().max(2000).optional(),
        content_type: z.enum(['json', 'form']).optional(),
        secret: z.string().max(255).optional(),
        insecure_ssl: z.union([z.string().max(1), z.number()]).optional(),
    }).strict().optional(),
    events: z.array(z.string().min(1).max(50)).max(100).optional(),
    add_events: z.array(z.string().min(1).max(50)).max(100).optional(),
    remove_events: z.array(z.string().min(1).max(50)).max(100).optional(),
    active: z.boolean().optional(),
}).strict();

// --- Workflow dispatch (POST /actions/workflows/:id/dispatches) ---
//
// The frontend sends `{ ref }` (repoActionsApi.triggerDispatch / the Teams run
// button); GitHub also accepts an `inputs` map. `ref` is optional here because
// the handler defaults it to 'main'. `inputs` values are scalars only — GitHub
// rejects nested objects. `ref` is forwarded in the JSON body (not the URL) so
// a length bound is sufficient.
export const workflowDispatchSchema = z.object({
    ref: z.string().min(1).max(255).optional(),
    inputs: z.record(
        z.string().max(100),
        z.union([z.string().max(1000), z.number(), z.boolean()]),
    ).optional(),
}).strict();

// --- Empty-body POST endpoints (ping webhook, sync actions) ---
//
// These callers send no body; express.json() still yields `{}` (body-parser
// initialises `req.body` before the content-type check). A strict empty object
// accepts the real `{}` while rejecting any stray/injected fields.
export const emptyBodySchema = z.object({}).strict();

// --- Community-health AI auto-fix (generate / commit-fix) ---
//
// `fileType` stays a bounded string (NOT an enum): the FILE_GENERATORS registry
// in the handler is the single source of truth for valid keys and emits a
// specific `invalid_file_type` code, so duplicating the key list here would
// create a second source and a less useful error. The schema bounds lengths,
// validates the `overrides` shape (unknown override keys are stripped, not
// rejected), and rejects unknown envelope keys.
export const communityHealthGenerateSchema = z.object({
    fileType: z.string().min(1).max(60),
    overrides: z.object({
        licenseId: z.string().min(1).max(50).optional(),
        email: z.string().max(320).optional(),
    }).strip().optional().default({}),
}).strict();

// commit-fix: filePath/content/commitMessage stay OPTIONAL here because the
// handler's presence check emits the domain-specific `invalid_body` code that
// the route contract (and its test) already established; the schema bounds
// lengths, validates `mode`, and rejects unknown keys. `content` is capped like
// the raw contents route.
export const communityHealthCommitFixSchema = z.object({
    filePath: z.string().max(1024).optional(),
    content: z.string().max(2_000_000).optional(),
    commitMessage: z.string().max(10_000).optional(),
    mode: z.enum(['direct', 'pr']).optional().default('direct'),
}).strict();

// --- Middleware factory ---
//
// The legacy `validate()` helper was removed in the P1-F / P3-Q validation
// migration. All routes now use `validateBody` / `validateQuery` /
// `validateParams` from `../middleware/validate-request.js`, which emit the
// standardised `{ error, code: 'validation_failed' }` envelope and attach
// parsed data at `req.validatedBody` etc. This module continues to export
// the shared Zod schemas only.
