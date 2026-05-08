/*
 * GitHub Repo Manager - AI Dev Toolkit Routes
 *
 * Endpoints:
 *   POST /ai/quality-report
 *   POST /ai/review-summary
 *   POST /ai/generate-commit
 *   POST /ai/generate-pr
 *   POST /ai/refine
 *   POST /ai/analyze-context
 *   POST /ai/chat-refine
 */

import express from 'express';
import { githubApi } from '../../lib/github-api.js';
import { requireAuth, safeError, isValidGitHubFullName } from '../../middleware/auth.js';
import { aiService, sanitizeForPrompt } from '../../ai-service.js';
import { checkUsageLimit, incrementUsage, checkAIFeatureLimit, incrementAIUsage, quotaExceededResponse } from '../../lib/usage-meter.js';
import { auditLog } from '../../lib/audit.js';
import { initSSE, streamToSSE } from '../ai-streaming.js';
import { requireAI } from './shared.js';
import { mapAIErrorToResponse } from '../../middleware/ai-error-mapper.js';
import { validateBody } from '../../middleware/validate-request.js';
import {
    aiQualityReportSchema,
    aiReviewSummarySchema,
    aiGenerateCommitSchema,
    aiGeneratePrSchema,
    aiRefineSchema,
    aiChatRefineSchema,
    aiAnalyzeContextSchema,
    REFINE_INSTRUCTIONS,
} from '../../lib/validators.js';
import { createCache } from '../../lib/memory-cache.js';

const router = express.Router();

// Quality Report - Comprehensive repo health analysis
router.post('/ai/quality-report', requireAuth, validateBody(aiQualityReportSchema), requireAI, async (req, res) => {
    const userId = req.session.userId;
    const check = checkAIFeatureLimit(userId, 'ai_insights');
    if (!check.allowed) return res.status(429).json(quotaExceededResponse(check));
    try {
        const { repo } = req.validatedBody;
        if (!isValidGitHubFullName(repo.full_name)) {
            return res.status(400).json({ error: 'Invalid repo.full_name', code: 'validation_failed' });
        }
        const safeFullName = encodeURI(repo.full_name);

        // Fetch README. 404 means no README exists yet — that's expected, the
        // AI report just runs without it. Anything else (401/403 token issue,
        // 5xx, network) we log for observability so silent degradation doesn't
        // mask a real auth failure.
        let readmeContent = '';
        try {
            const { data } = await githubApi(`/repos/${safeFullName}/readme`, req.session.accessToken);
            readmeContent = Buffer.from(data.content, 'base64').toString('utf-8');
        } catch (e) {
            if (e?.status !== 404) req.log.warn({ err: e, repo: repo.full_name }, 'Quality report: README fetch failed');
        }

        // Fetch file structure. Same logic — 404 is "empty repo", anything
        // else is worth a warn.
        let fileStructure = [];
        try {
            const { data } = await githubApi(`/repos/${safeFullName}/contents`, req.session.accessToken);
            fileStructure = data.map(f => ({ name: f.name, type: f.type }));
        } catch (e) {
            if (e?.status !== 404) req.log.warn({ err: e, repo: repo.full_name }, 'Quality report: contents fetch failed');
        }

        const report = await aiService.generateQualityReport(repo, readmeContent, fileStructure);
        incrementAIUsage(userId, 'ai_insights');
        auditLog(req, 'ai.quality_report', 'ai', null, { repoName: repo.full_name });
        res.json({ success: true, report, repo: repo.full_name });

    } catch (error) {
        req.log.error({ err: error }, 'Quality report generation failed');
        if (mapAIErrorToResponse(res, error)) return;
        res.status(500).json({ error: safeError(error, 'Failed to generate quality report') });
    }
});

// ------------------------------------------------------------------
// AI PR Review Summary
// ------------------------------------------------------------------

// Generate an AI-powered PR review summary
router.post('/ai/review-summary', requireAuth, validateBody(aiReviewSummarySchema), requireAI, async (req, res) => {
    // Feature toggle BEFORE the quota check — disabling the feature should
    // never burn the user's quota or look like a 429.
    if (process.env.DISABLE_AI_REVIEW === 'true') {
        return res.status(404).json({
            error: 'AI review summaries are disabled on this server.',
            code: 'AI_REVIEW_DISABLED'
        });
    }

    const userId = req.session.userId;
    const check = checkUsageLimit(userId, 'ai_queries');
    if (!check.allowed) {
        // Use the canonical quota envelope so the client's <QuotaExceededState />
        // primitive (gated on `code === 'QUOTA_EXCEEDED'`) renders correctly.
        return res.status(429).json(quotaExceededResponse({ ...check, metric: 'ai_queries' }));
    }

    try {
        const { fileManifest, topFilePatches, prMetadata } = req.validatedBody;

        if (req.query.stream === 'true') {
            // Streaming branch: build prompt inline, stream raw text, parse on completion
            const sse = initSSE(res);
            try {
                const systemPrompt = `You are an expert code reviewer analyzing a GitHub pull request.
Provide a structured review summary. Respond with ONLY valid JSON:
{"overview":"...","riskLevel":"low|medium|high|critical","keyChanges":["..."],"fileRisks":[{"file":"...","risk":"low|medium|high","reason":"..."}],"suggestedReviewOrder":["..."],"estimatedReviewTime":"..."}`;

                const prContext = `PR: ${sanitizeForPrompt(prMetadata.title, 200)}
Files: ${fileManifest?.length || 0}, +${prMetadata.additions || 0} -${prMetadata.deletions || 0}
File manifest: ${sanitizeForPrompt(JSON.stringify((fileManifest || []).map(f => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions }))), 3000)}`;

                const patchText = sanitizeForPrompt(
                    (topFilePatches || []).map(f => `${f.filename}:\n${f.patch || ''}`).join('\n---\n'),
                    80000
                );

                const textStream = req.aiProvider.generateStream({
                    prompt: systemPrompt + '\n\n' + prContext + '\n\nDiff:\n' + patchText,
                    signal: sse.signal,
                });
                const raw = await streamToSSE(textStream, sse);

                let parsed;
                try {
                    parsed = JSON.parse(raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, ''));
                } catch {
                    parsed = { overview: raw, riskLevel: 'medium', keyChanges: [], fileRisks: [], suggestedReviewOrder: [], estimatedReviewTime: 'unknown' };
                }

                // Normalize field names to match QuickSummary expectations
                const normalized = {
                    overallRisk: parsed.riskLevel || parsed.overallRisk || 'medium',
                    overview: parsed.overview || '',
                    keyChanges: parsed.keyChanges || [],
                    fileRisks: (parsed.fileRisks || []).map(f => ({
                        filename: f.file || f.filename || '',
                        level: f.risk || f.level || 'low',
                        reason: f.reason || '',
                    })),
                    suggestedReviewOrder: parsed.suggestedReviewOrder || [],
                    estimatedReviewTime: parsed.estimatedReviewTime || '',
                };

                incrementUsage(userId, 'ai_queries');
                auditLog(req, 'ai.review_summary', 'ai', null, { repo: prMetadata?.repo, fileCount: fileManifest?.length, streamed: true });

                sse.sendDone(normalized);
            } catch (err) {
                sse.sendError('Failed to generate review summary');
            }
            return;
        }

        // Non-streaming (existing behavior)
        const summary = await aiService.reviewPullRequest(fileManifest, topFilePatches, prMetadata);

        if (summary === null) {
            return res.status(404).json({
                error: 'AI review summaries are disabled on this server.',
                code: 'AI_REVIEW_DISABLED'
            });
        }

        incrementUsage(userId, 'ai_queries');
        auditLog(req, 'ai.review_summary', 'ai', null, {
            repo: prMetadata?.repo,
            prNumber: prMetadata?.number,
            fileCount: fileManifest?.length
        });
        res.json({ success: true, summary });
    } catch (error) {
        req.log.error({ err: error }, 'AI PR review summary failed');
        if (mapAIErrorToResponse(res, error)) return;
        res.status(500).json({ error: safeError(error, 'Failed to generate review summary') });
    }
});

// ------------------------------------------------------------------
// Dev Toolkit — Generate Commit Message
// ------------------------------------------------------------------

router.post('/ai/generate-commit', requireAuth, validateBody(aiGenerateCommitSchema), requireAI, async (req, res) => {
    try {
        const { diff, format = 'conventional', repo_style, repo_context } = req.validatedBody;

        const userId = req.session.userId;
        const limit = checkAIFeatureLimit(userId, 'ai_commit');
        if (!limit.allowed) return res.status(429).json(quotaExceededResponse(limit));

        const formatInstructions = {
            conventional: 'Use Conventional Commits format: type(scope): description. Types: feat, fix, chore, refactor, docs, style, perf, test, build, ci, revert.',
            gitmoji: 'Use Gitmoji format: :emoji: description. Use standard gitmoji codes like :sparkles:, :bug:, :recycle:, :memo:, :art:, etc.',
            descriptive: 'Use a clear, descriptive sentence in imperative mood. Example: "Add user login functionality with JWT tokens".',
            'repo-convention': repo_style
                ? `Mimic this repository's commit style. Detected pattern: "${repo_style.pattern}". Examples from repo: ${(repo_style.examples || []).join('; ')}.`
                : 'Use Conventional Commits format as fallback.',
        };

        const safeDiff = sanitizeForPrompt(diff, 12000);
        const contextLine = repo_context?.name
            ? `Repository: ${repo_context.name}${repo_context.description ? ` — ${repo_context.description}` : ''}\n`
            : '';

        const systemPrompt = `You are a commit message generator. ${formatInstructions[format] || formatInstructions.conventional}

${contextLine}Respond with ONLY valid JSON in this exact shape:
{"subject": "the commit subject line", "body": "optional multi-line body or empty string"}

Rules:
- subject must be under 72 characters
- body uses bullet points with "- " prefix if present
- No markdown fences, no explanation, ONLY the JSON object`;

        // Provider-neutral path via req.aiProvider (works with Gemini,
        // Anthropic, OpenAI, OpenRouter, LocalProvider). Previously this
        // called Gemini's startChat() session API, so any user on Claude/
        // OpenAI would silently fall back to Gemini or break. The "history"
        // here was only priming (system prompt + dummy reply), never real
        // multi-turn state, so a single prompt carries the same semantics.
        const userMessage = `Generate a commit message for this diff:\n\n${safeDiff}`;

        if (req.query.stream === 'true') {
            const sse = initSSE(res);
            try {
                const iter = req.aiProvider.generateStream({
                    prompt: systemPrompt + '\n\n' + userMessage,
                });
                const raw = await streamToSSE(iter, sse);

                let parsed;
                try {
                    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
                    parsed = JSON.parse(cleaned);
                } catch {
                    parsed = { subject: raw.split('\n')[0], body: '' };
                }
                const message = parsed.body ? `${parsed.subject}\n\n${parsed.body}` : parsed.subject;

                incrementAIUsage(userId, 'ai_commit');
                auditLog(req, 'ai_generate_commit', 'ai', null, { format, diff_length: diff.length, streamed: true });

                sse.sendDone({ message, subject: parsed.subject, body: parsed.body || '', format_used: format });
            } catch {
                sse.sendError('Failed to generate commit message');
            }
            return;
        }

        const { text: raw } = await req.aiProvider.generate({
            prompt: userMessage,
            systemPrompt,
        });

        let parsed;
        try {
            const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
            parsed = JSON.parse(cleaned);
        } catch {
            parsed = { subject: raw.split('\n')[0], body: '' };
        }

        const message = parsed.body
            ? `${parsed.subject}\n\n${parsed.body}`
            : parsed.subject;

        incrementAIUsage(userId, 'ai_commit');
        auditLog(req, 'ai_generate_commit', 'ai', null, { format, diff_length: diff.length });

        res.json({
            message,
            subject: parsed.subject,
            body: parsed.body || '',
            format_used: format,
        });
    } catch (error) {
        req.log.error({ err: error }, 'Generate commit message failed');
        if (mapAIErrorToResponse(res, error)) return;
        res.status(500).json({ error: safeError(error, 'Failed to generate commit message') });
    }
});

// ------------------------------------------------------------------
// Dev Toolkit — Generate PR Description
// ------------------------------------------------------------------

router.post('/ai/generate-pr', requireAuth, validateBody(aiGeneratePrSchema), requireAI, async (req, res) => {
    try {
        const { commits, diff_summary, top_patches, template, repo_context } = req.validatedBody;

        const userId = req.session.userId;
        const limit = checkUsageLimit(userId, 'ai_queries');
        if (!limit.allowed) {
            // Canonical quota envelope so the frontend's <QuotaExceededState />
            // surfaces a real reset date instead of the previous "next month"
            // hardcode driven by a non-existent `resetDate` field.
            return res.status(429).json(quotaExceededResponse({ ...limit, metric: 'ai_queries' }));
        }

        const commitList = commits.map(c => `- ${c.message}`).join('\n');
        const filesInfo = diff_summary?.files
            ? diff_summary.files.map(f => `${f.filename} (+${f.additions} -${f.deletions})`).join('\n')
            : '';
        const safePatches = sanitizeForPrompt(top_patches || '', 15000);
        const templateInstruction = template
            ? `\nUse this PR template as the structure for the summary:\n${template}\n`
            : '';
        const repoLine = repo_context?.name ? `Repository: ${repo_context.name}\n` : '';

        const systemPrompt = `You are a PR description generator. ${repoLine}${templateInstruction}

Respond with ONLY valid JSON in this exact shape:
{
  "title": "short PR title under 70 chars",
  "summary": "## Summary\\nmarkdown bullet points",
  "test_plan": "## Test plan\\n- [ ] checklist items",
  "breaking_changes": null or "## Breaking Changes\\n...",
  "related_issues": [{"number": 123, "relation": "closes|fixes|relates"}],
  "suggested_labels": ["label1", "label2"],
  "suggested_reviewers": ["username1"]
}

Rules:
- Extract issue references from commit messages (#NNN, fixes #NNN, closes #NNN)
- Suggest labels based on file paths and commit types
- Suggest reviewers is best-effort, return empty array if unsure
- breaking_changes should be null if none detected
- No markdown fences in the response, ONLY the JSON object`;

        // Provider-neutral path via req.aiProvider — see /ai/generate-commit
        // above for the rationale. The old Gemini startChat history was only
        // priming, never multi-turn state.
        const userMessage = `Generate a PR description.\n\nCommits:\n${commitList}\n\nFiles changed:\n${filesInfo}\n\nPatches:\n${safePatches}`;

        if (req.query.stream === 'true') {
            const sse = initSSE(res);
            try {
                const iter = req.aiProvider.generateStream({
                    prompt: systemPrompt + '\n\n' + userMessage,
                });
                const raw = await streamToSSE(iter, sse);

                let parsed;
                try {
                    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
                    parsed = JSON.parse(cleaned);
                } catch {
                    parsed = { title: commits[0]?.message?.split('\n')[0] || 'Update', summary: raw, test_plan: '', breaking_changes: null, related_issues: [], suggested_labels: [], suggested_reviewers: [] };
                }

                incrementUsage(userId, 'ai_queries');
                auditLog(req, 'ai_generate_pr', 'ai', null, { commit_count: commits.length, streamed: true });

                sse.sendDone({
                    title: parsed.title || '', summary: parsed.summary || '', test_plan: parsed.test_plan || '',
                    breaking_changes: parsed.breaking_changes || null, related_issues: parsed.related_issues || [],
                    suggested_labels: parsed.suggested_labels || [], suggested_reviewers: parsed.suggested_reviewers || [],
                });
            } catch (err) {
                sse.sendError('Failed to generate PR description');
            }
            return;
        }

        const { text: raw } = await req.aiProvider.generate({
            prompt: userMessage,
            systemPrompt,
        });

        let parsed;
        try {
            const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
            parsed = JSON.parse(cleaned);
        } catch {
            parsed = {
                title: commits[0]?.message?.split('\n')[0] || 'Update',
                summary: raw,
                test_plan: '',
                breaking_changes: null,
                related_issues: [],
                suggested_labels: [],
                suggested_reviewers: [],
            };
        }

        incrementUsage(userId, 'ai_queries');
        auditLog(req, 'ai_generate_pr', 'ai', null, { commit_count: commits.length });

        res.json({
            title: parsed.title || '',
            summary: parsed.summary || '',
            test_plan: parsed.test_plan || '',
            breaking_changes: parsed.breaking_changes || null,
            related_issues: parsed.related_issues || [],
            suggested_labels: parsed.suggested_labels || [],
            suggested_reviewers: parsed.suggested_reviewers || [],
        });
    } catch (error) {
        req.log.error({ err: error }, 'Generate PR description failed');
        if (mapAIErrorToResponse(res, error)) return;
        res.status(500).json({ error: safeError(error, 'Failed to generate PR description') });
    }
});

// ------------------------------------------------------------------
// Dev Toolkit — Refine Content
// ------------------------------------------------------------------

// Refinement instruction allow-list: every accepted key maps to a safe,
// server-controlled prompt fragment. We never fall through to the raw user
// string — the schema's `enum` already rejects unknown values, but this
// table is the single source of truth for what a key actually expands to.
const REFINEMENT_INSTRUCTIONS = {
    shorter: 'Make this shorter and more concise. Remove the body if present, keep only the subject line.',
    more_detail: 'Add more detail. Include a multi-line body with bullet points explaining the changes.',
    add_body: 'Keep the subject line as-is but add an explanatory body paragraph below it.',
    breaking_change: 'Add a BREAKING CHANGE: footer explaining what breaks and how to migrate.',
    more_cases: 'Add more test cases to cover additional scenarios.',
    edge_cases: 'Add edge case test scenarios (empty inputs, boundary values, error conditions).',
    e2e_focus: 'Rewrite the test plan focusing on end-to-end user workflows.',
    architecture_notes: 'Add a section about the architectural decisions and technical approach.',
    more_context: 'Add more context about what changed and why. Include background information and motivation.',
};

router.post('/ai/refine', requireAuth, validateBody(aiRefineSchema), requireAI, async (req, res) => {
    try {
        const { original_content, original_diff, instruction, content_type } = req.validatedBody;

        const userId = req.session.userId;
        const limit = checkUsageLimit(userId, 'ai_queries');
        if (!limit.allowed) {
            return res.status(429).json(quotaExceededResponse({ ...limit, metric: 'ai_queries' }));
        }

        const safeContentType = content_type || 'content';
        // The schema's z.enum() guarantees `instruction` is in REFINE_INSTRUCTIONS,
        // so the table lookup never returns undefined. Defensive default kept
        // so a future schema relaxation can't bypass the allow-list.
        const instructionText = REFINEMENT_INSTRUCTIONS[instruction] || REFINEMENT_INSTRUCTIONS.more_context;
        const safeOriginal = sanitizeForPrompt(original_content, 6000);
        const safeDiff = original_diff ? sanitizeForPrompt(original_diff, 8000) : '';
        const diffContext = safeDiff ? `\n\nOriginal diff for context:\n${safeDiff}` : '';

        const systemPrompt = `You are refining ${safeContentType}. Apply the requested change to the content below.
Return ONLY the refined content, no explanation, no markdown fences.`;

        // Provider-neutral path via req.aiProvider — see /ai/generate-commit
        // above for the rationale. The old "Ready." dummy reply priming is
        // now a single prompt passed through the abstraction.
        const userMessage = `Refinement instruction: ${instructionText}\n\nOriginal content:\n${safeOriginal}${diffContext}`;

        if (req.query.stream === 'true') {
            const sse = initSSE(res);
            try {
                const iter = req.aiProvider.generateStream({
                    prompt: systemPrompt + '\n\n' + userMessage,
                });
                const raw = await streamToSSE(iter, sse);

                incrementUsage(userId, 'ai_queries');
                auditLog(req, 'ai_refine', 'ai', null, { instruction, content_type, streamed: true });

                sse.sendDone({ refined_content: raw.trim() });
            } catch {
                sse.sendError('Failed to refine content');
            }
            return;
        }

        const { text: rawRefined } = await req.aiProvider.generate({
            prompt: userMessage,
            systemPrompt,
        });
        const refined = rawRefined.trim();

        incrementUsage(userId, 'ai_queries');
        auditLog(req, 'ai_refine', 'ai', null, { instruction, content_type });

        res.json({ refined_content: refined });
    } catch (error) {
        req.log.error({ err: error }, 'Refine content failed');
        if (mapAIErrorToResponse(res, error)) return;
        res.status(500).json({ error: safeError(error, 'Failed to refine content') });
    }
});

// ------------------------------------------------------------------
// Dev Toolkit — Analyze Context (Smart Bar)
// ------------------------------------------------------------------

// Bounded LRU cache (TTL + maxSize) so the analyze-context cache cannot
// grow unbounded across long-running deploys. Keys MUST embed userId so two
// users with the same repo+diff stats never see each other's analysis.
const contextCache = createCache({ ttlMs: 30_000, maxSize: 500 });

router.post('/ai/analyze-context', requireAuth, validateBody(aiAnalyzeContextSchema), requireAI, async (req, res) => {
    try {
        const { repo, diff_summary, commits, file_list } = req.validatedBody;
        const userId = req.session.userId;

        const cacheKey = `${userId}:${repo}:${diff_summary.files}:${diff_summary.additions}:${diff_summary.deletions}`;
        const cached = contextCache.get(cacheKey);
        if (cached) {
            return res.json(cached);
        }

        const limit = checkUsageLimit(userId, 'ai_queries');
        if (!limit.allowed) {
            return res.status(429).json(quotaExceededResponse({ ...limit, metric: 'ai_queries' }));
        }

        const commitMessages = (commits || []).map(c => c.message).join('\n');
        const files = (file_list || []).join(', ');

        const prompt = `Classify this code change. Respond with ONLY valid JSON:
{"changeType": "feature|bugfix|refactor|breaking|chore", "complexity": "low|medium|high", "breakingChanges": true|false}

Files: ${sanitizeForPrompt(files, 2000)}
Commits: ${sanitizeForPrompt(commitMessages, 2000)}
Stats: ${diff_summary.files} files, +${diff_summary.additions} -${diff_summary.deletions}`;

        const { text: raw } = await req.aiProvider.generate({ prompt });

        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch {
            parsed = { changeType: 'chore', complexity: 'medium', breakingChanges: false };
        }

        const suggestions = [];
        if (commits && commits.length > 0) {
            suggestions.push({ type: 'generate_pr', message: `${commits.length} commit${commits.length > 1 ? 's' : ''} — generate PR description?`, tab: 'pr' });
        }
        if (parsed.breakingChanges) {
            suggestions.push({ type: 'breaking', message: 'Breaking changes detected — mark in commit', tab: 'commits' });
        }

        const responseData = {
            changeType: parsed.changeType || 'chore',
            complexity: parsed.complexity || 'medium',
            suggestions,
            breakingChanges: parsed.breakingChanges || false,
        };

        incrementUsage(userId, 'ai_queries');
        contextCache.set(cacheKey, responseData);

        res.json(responseData);
    } catch (error) {
        req.log.error({ err: error }, 'Analyze context failed');
        if (mapAIErrorToResponse(res, error)) return;
        res.status(500).json({ error: safeError(error, 'Failed to analyze context') });
    }
});

// ------------------------------------------------------------------
// Dev Toolkit — Conversational Refine (always streaming)
// ------------------------------------------------------------------

router.post('/ai/chat-refine', requireAuth, validateBody(aiChatRefineSchema), requireAI, async (req, res) => {
    try {
        const { message, current_output, original_diff, content_type, history } = req.validatedBody;

        const userId = req.session.userId;
        const limit = checkUsageLimit(userId, 'ai_queries');
        if (!limit.allowed) {
            return res.status(429).json(quotaExceededResponse({ ...limit, metric: 'ai_queries' }));
        }

        const CONTENT_TYPE_LABELS = {
            commit: 'commit message',
            pr_summary: 'PR summary',
            pr_test_plan: 'PR test plan',
            review_qa: 'code review Q&A',
        };
        const typeLabel = CONTENT_TYPE_LABELS[content_type] || 'content';

        const safeDiff = original_diff ? sanitizeForPrompt(original_diff, 8000) : '';
        const diffCtx = safeDiff ? `\n\nDiff context:\n${safeDiff}` : '';

        const systemPrompt = `You are a helpful AI assistant refining ${typeLabel}. Apply the user's instruction to improve the content. Return ONLY the refined content, no explanation.${diffCtx}`;

        // Flatten the conversation into a single stateless prompt so the
        // provider abstraction can handle it regardless of vendor. Modern
        // chat models (Gemini, Claude, GPT) follow labelled transcripts,
        // so we emit "User:" / "Assistant:" markers for history turns and
        // end with the latest user message. This is what replaces the old
        // Gemini-specific startChat({ history }) path.
        // The schema enforces role ∈ {'user','assistant'} so role spoofing
        // (System: …) is structurally rejected before this code runs.
        const safeHistory = Array.isArray(history) ? history.slice(-10) : [];
        const historyBlock = safeHistory
            .map((entry) => {
                const role = entry.role === 'user' ? 'User' : 'Assistant';
                return `${role}: ${sanitizeForPrompt(entry.content, 4000)}`;
            })
            .join('\n\n');

        const userMessage = current_output
            ? `Current content:\n${sanitizeForPrompt(current_output, 6000)}\n\nInstruction: ${message}`
            : message;

        const fullPrompt = [
            historyBlock ? `Conversation so far:\n${historyBlock}` : null,
            `User: ${userMessage}`,
            'Assistant:',
        ].filter(Boolean).join('\n\n');

        const sse = initSSE(res);
        try {
            const iter = req.aiProvider.generateStream({
                prompt: systemPrompt + '\n\n' + fullPrompt,
            });
            const raw = await streamToSSE(iter, sse);

            incrementUsage(userId, 'ai_queries');
            auditLog(req, 'ai_chat_refine', 'ai', null, { content_type, message_length: message.length });

            sse.sendDone({ refined_content: raw.trim() });
        } catch {
            sse.sendError('Failed to refine content');
        }
    } catch (error) {
        req.log.error({ err: error }, 'Chat refine failed');
        if (!res.headersSent) {
            if (mapAIErrorToResponse(res, error)) return;
            res.status(500).json({ error: safeError(error, 'Failed to chat refine') });
        }
    }
});

export default router;
