/*
 * GitHub Repo Manager - AI Diagram Generator Route
 *
 * Endpoints:
 *   POST /ai/generate-diagram                 — AI-generated Mermaid (metered)
 *   POST /ai/generate-diagram/deterministic   — zero-AI-cost fallback flowchart
 *   POST /ai/generate-diagram/embed-preview   — compute the exact embed diff (no write)
 *   POST /ai/generate-diagram/embed-commit    — write the diagram into the repo
 *
 * Generates a Mermaid diagram (v1: architecture/module graph only) grounded
 * in the repo's actual top-level contents, a capped recursive file tree, and
 * a README excerpt — the same signal sources POST /ai/quality-report already
 * fetches. The model is constrained to emit raw Mermaid text only (no fence,
 * no prose); the server does light defensive fence-stripping but performs NO
 * Mermaid syntax validation — mermaid.parse()/render() are DOM-dependent
 * (v11) and unsafe to call in Node, so the client is the source of truth for
 * "did this render" (see src/components/AI/DiagramGenerator.jsx).
 *
 * Retry-once self-repair: when the client reports a render failure it
 * re-posts with `retry: true` + `failedSource` + `parseError`. That second
 * call is a real provider spend event (checked against the spend cap like
 * any other call) but is NOT re-checked/re-decremented against the
 * diagramGenPerMonth feature quota — check-once, increment-once per logical
 * user request (docs/specs/2026-07-18-community-wow-wave6.md §Feature 2,
 * research §4a). A manual "Regenerate" after a second failure is a fully new
 * request (retry: false) and is metered normally.
 *
 * Embed into the repo (Addendum 6b.1): a generated diagram can be written
 * into the repository — either as a ```mermaid fence directly in README.md
 * (idempotent via `<!-- repo-manager:diagram:<type>:start/end -->` markers,
 * see server/lib/ai-features/diagram-embed.js) or as a sanitized, size-guarded
 * SVG committed to docs/diagrams/<type>.svg with a README image reference.
 * Both paths go through a mandatory embed-preview → embed-commit round trip
 * and commitOrOpenPR() (unmodified) for the actual write — no new commit
 * primitive, no auto-write.
 */

import express from 'express';
import { githubApi } from '../../lib/github-api.js';
import { requireAuth, isValidGitHubFullName } from '../../middleware/auth.js';
import { requireScope } from '../../middleware/api-key-auth.js';
import { validateBody } from '../../middleware/validate-request.js';
import { aiGenerateDiagramSchema, deterministicDiagramSchema, embedDiagramPreviewSchema, embedDiagramCommitSchema } from '../../lib/validators.js';
import { sanitizeForPrompt } from '../../ai-service.js';
import { checkAIFeatureLimit, incrementAIUsage, quotaExceededResponse } from '../../lib/usage-meter.js';
import { auditLog } from '../../lib/audit.js';
import { requireAI, guardedGenerate, handleAIError, denyIfSpendCapReached, recordStreamCompletion } from './shared.js';
import { initSSE, streamToSSEWithUsage } from '../ai-streaming.js';
import { resolveMaxOutputTokens } from '../../lib/ai-output-budget.js';
import { commitOrOpenPR } from '../../lib/ai-features/community-health-fix.js';
import {
    buildDeterministicDiagram, buildMermaidEmbedBlock, buildSvgRefEmbedBlock,
    insertOrReplaceBlock, sanitizeSvg,
} from '../../lib/ai-features/diagram-embed.js';

const router = express.Router();

// Lighter caps than the file-picker tree endpoint (server/routes/repos/tree.js's
// 500) — a diagram prompt needs enough paths to infer module structure, not
// every file, and every extra path is prompt-token cost.
const MAX_TREE_ENTRIES = 300;
const MAX_TOP_LEVEL = 60;
const MAX_README_CHARS = 1500;

/**
 * Pure prompt builder — exported for unit testing without a provider mock.
 * Carries the "never invent" grounding rule (mirrors community-health-fix.js
 * in spirit) and, on retry, appends the failed Mermaid + parser error so the
 * model can self-repair instead of guessing blind a second time.
 *
 * @param {object} params
 * @param {object} params.repo                 — { full_name, language }
 * @param {string} params.diagramType          — 'architecture' (v1)
 * @param {string} [params.focus]
 * @param {Array<{name:string,type:string}>} [params.topLevel]
 * @param {Array<{path:string}>} [params.treeEntries]
 * @param {boolean} [params.truncated]
 * @param {string} [params.readmeSnippet]
 * @param {boolean} [params.retry]
 * @param {string} [params.failedSource]
 * @param {string} [params.parseError]
 * @returns {string}
 */
export function buildDiagramPrompt({
    repo, diagramType, focus, topLevel, treeEntries, truncated, readmeSnippet,
    retry, failedSource, parseError,
}) {
    const repoName = repo?.full_name || 'this repository';
    const languageLine = repo?.language ? ` Primary language: ${sanitizeForPrompt(repo.language, 50)}.` : '';

    const topLevelList = (topLevel || [])
        .slice(0, MAX_TOP_LEVEL)
        .map((f) => `${f.type === 'dir' ? '[dir]' : '[file]'} ${f.name}`)
        .join('\n');
    const treeList = (treeEntries || []).slice(0, MAX_TREE_ENTRIES).map((e) => e.path).join('\n');
    const readmePart = readmeSnippet ? `\n\nREADME excerpt:\n${sanitizeForPrompt(readmeSnippet, MAX_README_CHARS)}` : '';
    const focusPart = focus ? `\n\nFocus the diagram on: ${sanitizeForPrompt(focus, 300)}` : '';
    const truncationNote = truncated
        ? '\n\nNote: the file listing below is truncated (large repo) — work only with what is shown, do not invent additional structure to fill gaps.'
        : '';
    const sparseNote = (!treeEntries || treeEntries.length < 3)
        ? '\n\nThis repository has very little detectable file structure. If there is not enough information for a meaningful diagram, return a minimal 2-3 node Mermaid diagram that honestly reflects the sparse structure instead of inventing files, modules, or services that were not observed.'
        : '';

    const basePrompt = `You are generating a ${diagramType} diagram for the GitHub repository "${repoName}" as Mermaid diagram source (use "graph TD" or "flowchart TD").${languageLine}

Rules:
- Base the diagram ONLY on the file/folder structure and README excerpt below — never invent files, modules, services, dependencies, or relationships that are not evidenced by this context.
- Group related files into logical modules/components using the folder structure as your primary signal.
- Keep node labels short (folder/module names). Edges represent your best-effort inference of how modules relate from names and structure — this is an approximation, not a verified static-analysis dependency graph.
- Output ONLY the raw Mermaid diagram source. No prose, no explanation, no markdown code fence — start directly with the diagram type declaration.${truncationNote}${sparseNote}

Top-level contents:
${topLevelList || '(none detected)'}

File tree (partial):
${treeList || '(none detected)'}${readmePart}${focusPart}`;

    if (retry && failedSource) {
        return `${basePrompt}

Your previous attempt produced Mermaid text that failed to parse:
\`\`\`
${sanitizeForPrompt(failedSource, 4000)}
\`\`\`
Parser error: ${sanitizeForPrompt(parseError || 'unknown syntax error', 500)}

Fix the syntax and return ONLY the corrected, valid Mermaid diagram source — still following every rule above.`;
    }

    return basePrompt;
}

/**
 * Strip a ```mermaid / ``` fence wrapper the model may have added despite
 * being told not to — the same defensive `raw.replace(...)` idiom used
 * throughout dev-toolkit.js, adapted for a mermaid fence instead of json.
 * No syntax validation happens here (see file header) — this only removes
 * wrapper noise so the client hands mermaid.render() clean source.
 *
 * @param {string} raw
 * @returns {string}
 */
export function cleanMermaidText(raw) {
    if (typeof raw !== 'string') return '';
    return raw.trim()
        .replace(/^```(?:mermaid)?\r?\n?/i, '')
        .replace(/\r?\n?```\s*$/, '')
        .trim();
}

/**
 * Fetch the grounding signals for a diagram prompt: top-level contents,
 * a capped recursive file tree, and a README excerpt. Mirrors the tolerant
 * 404-is-fine / anything-else-is-a-warn pattern already used by
 * POST /ai/quality-report and server/routes/repos/tree.js — degrades to an
 * empty signal set rather than failing the whole request on a missing
 * README or an empty repo.
 */
export async function fetchDiagramContext({ owner, repo, accessToken, log }) {
    let topLevel = [];
    try {
        const { data } = await githubApi(`/repos/${owner}/${repo}/contents`, accessToken);
        topLevel = Array.isArray(data) ? data.map((f) => ({ name: f.name, type: f.type })) : [];
    } catch (e) {
        if (e?.status !== 404) log?.warn?.({ err: e, owner, repo }, 'Diagram generation: contents fetch failed');
    }

    let treeEntries = [];
    let truncated = false;
    try {
        const { data: repoMeta } = await githubApi(`/repos/${owner}/${repo}`, accessToken);
        const branch = repoMeta?.default_branch || 'main';
        const { data: branchData } = await githubApi(`/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`, accessToken);
        const sha = branchData?.commit?.sha;
        if (sha) {
            const { data: treeData } = await githubApi(`/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`, accessToken);
            const blobs = Array.isArray(treeData?.tree) ? treeData.tree.filter((e) => e?.type === 'blob') : [];
            truncated = !!treeData?.truncated || blobs.length > MAX_TREE_ENTRIES;
            treeEntries = blobs.slice(0, MAX_TREE_ENTRIES).map((e) => ({ path: e.path }));
        }
    } catch (e) {
        if (e?.status !== 404) log?.warn?.({ err: e, owner, repo }, 'Diagram generation: tree fetch failed');
    }

    let readmeSnippet = '';
    try {
        const { data } = await githubApi(`/repos/${owner}/${repo}/readme`, accessToken);
        readmeSnippet = Buffer.from(data.content, 'base64').toString('utf-8').slice(0, MAX_README_CHARS);
    } catch (e) {
        if (e?.status !== 404) log?.warn?.({ err: e, owner, repo }, 'Diagram generation: README fetch failed');
    }

    return { topLevel, treeEntries, truncated, readmeSnippet };
}

router.post('/ai/generate-diagram', requireAuth, requireScope('ai'), validateBody(aiGenerateDiagramSchema), requireAI, async (req, res) => {
    const userId = req.session.userId;
    const { repo, diagramType, focus, retry, failedSource, parseError } = req.validatedBody;

    if (!isValidGitHubFullName(repo.full_name)) {
        return res.status(400).json({ error: 'Invalid repo.full_name', code: 'validation_failed' });
    }

    // Check-once / increment-once: only the initial (non-retry) attempt
    // consumes the diagramGenPerMonth quota. See file header + research §4a.
    if (!retry) {
        const check = checkAIFeatureLimit(userId, 'ai_diagram');
        if (!check.allowed) return res.status(429).json(quotaExceededResponse(check));
    }

    const [owner, repoName] = repo.full_name.split('/');

    try {
        const { topLevel, treeEntries, truncated, readmeSnippet } = await fetchDiagramContext({
            owner, repo: repoName, accessToken: req.session.accessToken, log: req.log,
        });

        const prompt = buildDiagramPrompt({
            repo, diagramType, focus, topLevel, treeEntries, truncated, readmeSnippet,
            retry, failedSource, parseError,
        });

        if (req.query.stream === 'true') {
            // Pre-stream spend-cap check — a real spend event either way (first
            // attempt or self-repair retry), so this runs on both paths.
            if (denyIfSpendCapReached(req, res)) return;
            // initSSE(res) WITHOUT req — matches the rest of server/routes/ai/*:
            // a disconnect is detected via the next write failing, and passing
            // req here trips supertest's early 'close' event in tests.
            const sse = initSSE(res);
            try {
                const iter = req.aiProvider.generateStream({
                    prompt,
                    signal: sse.signal,
                    generationConfig: { maxOutputTokens: resolveMaxOutputTokens() },
                });
                const { text: raw, usage, costUSD } = await streamToSSEWithUsage(iter, sse);
                const mermaid = cleanMermaidText(raw);

                if (!retry) incrementAIUsage(userId, 'ai_diagram');
                recordStreamCompletion(req, {
                    feature: 'diagram',
                    action: 'ai.generate_diagram',
                    model: req.aiProvider?.model,
                    usage,
                    costUSD,
                    extraMeta: { repo: repo.full_name, diagramType, retry: !!retry },
                });

                sse.sendDone({ mermaid, diagramType, truncated });
            } catch (err) {
                req.log.error({ err }, 'Diagram stream generation failed');
                if (!sse.isAborted) sse.sendError('Failed to generate diagram. Please try again.');
            }
            return;
        }

        const { text } = await guardedGenerate(req, { prompt }, { feature: 'diagram' });
        const mermaid = cleanMermaidText(text);

        if (!retry) incrementAIUsage(userId, 'ai_diagram');
        auditLog(req, 'ai.generate_diagram', 'ai', null, { repo: repo.full_name, diagramType, retry: !!retry });

        res.json({ success: true, mermaid, diagramType, truncated });
    } catch (error) {
        req.log.error({ err: error, repo: repo.full_name }, 'Diagram generation failed');
        handleAIError(res, error, 'Failed to generate diagram. Please try again later.');
    }
});

// ------------------------------------------------------------------
// Deterministic (zero-AI-cost) fallback diagram.
//
// A depth-2, node-capped `flowchart TD` of the top-level directory
// structure — always succeeds, never calls a provider. Used directly by the
// embed flow's "invalid mermaid after the retry-once self-repair" edge case
// (Addendum 6b.1): rather than failing the embed outright, the client offers
// this as a substitute source. Not metered — reuses the same free tree/
// contents fetch the main route already performs.
// ------------------------------------------------------------------

router.post('/ai/generate-diagram/deterministic', requireAuth, requireScope('ai'), validateBody(deterministicDiagramSchema), async (req, res) => {
    const { repo, diagramType } = req.validatedBody;
    if (!isValidGitHubFullName(repo.full_name)) {
        return res.status(400).json({ error: 'Invalid repo.full_name', code: 'validation_failed' });
    }
    const [owner, repoName] = repo.full_name.split('/');

    try {
        const { topLevel, treeEntries, truncated } = await fetchDiagramContext({
            owner, repo: repoName, accessToken: req.session.accessToken, log: req.log,
        });
        const mermaid = buildDeterministicDiagram({ topLevel, treeEntries, truncated });
        res.json({ success: true, mermaid, diagramType, truncated, deterministic: true });
    } catch (error) {
        req.log.error({ err: error, repo: repo.full_name }, 'Deterministic diagram generation failed');
        res.status(500).json({ error: 'Failed to build a deterministic diagram. Please try again later.', code: 'deterministic_diagram_failed' });
    }
});

// ------------------------------------------------------------------
// Embed diagrams into the repository (Addendum 6b.1).
//
// Neither route below calls an AI provider — the caller already has the
// Mermaid/SVG (from POST /ai/generate-diagram, its retry-once self-repair, or
// the deterministic fallback above), so these are plain, auth-gated GitHub
// read/write actions, matching the shape of every other commit-only route in
// this codebase (community-health/commit-fix, agent-rules/commit): no
// requireScope('ai'), no requireAI, no quota check.
//
//   POST /ai/generate-diagram/embed-preview — computes the exact README
//     diff (and/or sanitized SVG) WITHOUT writing anything; mandatory before
//     embed-commit.
//   POST /ai/generate-diagram/embed-commit  — performs the actual write(s)
//     via commitOrOpenPR() (unmodified, verbatim — including its branch-
//     protection-probe -> PR-fallback behavior).
// ------------------------------------------------------------------

const DIAGRAM_LABELS = { architecture: 'Architecture diagram' };

function diagramLabel(diagramType) {
    return DIAGRAM_LABELS[diagramType] || `${diagramType} diagram`;
}

function svgPathFor(diagramType) {
    return `docs/diagrams/${diagramType}.svg`;
}

/**
 * Fetch the FULL (untruncated) README content + its exact path — the embed
 * flow must never operate on the truncated snippet the AI-prompt context
 * fetch above uses, or a marker insert/replace could clobber content beyond
 * what was actually read. Tolerant-404: no README is a legitimate, handled
 * state, not an error.
 *
 * A README that exists but is too large/binary for GitHub to inline comes
 * back with `encoding !== 'base64'` (typically `'none'` with empty content)
 * — a distinct state from "no README" (which the caller must not silently
 * fold into the same "create one first" branch), surfaced via `truncated: true`.
 */
async function fetchFullReadme({ owner, repo, accessToken, log }) {
    try {
        const { data } = await githubApi(`/repos/${owner}/${repo}/readme`, accessToken);
        if (data?.encoding === 'base64' && typeof data.content === 'string') {
            return { content: Buffer.from(data.content, 'base64').toString('utf-8'), path: data.path || 'README.md' };
        }
        if (data) {
            return { content: null, path: data.path || 'README.md', truncated: true };
        }
        return null;
    } catch (e) {
        if (e?.status !== 404) log?.warn?.({ err: e, owner, repo }, 'Diagram embed: README fetch failed');
        return null;
    }
}

/**
 * Repo-level push access via GitHub's `permissions.push` field on the
 * authenticated user's view of the repo. Deliberately conservative: only a
 * hard `false` is treated as read-only — a missing/undefined field (some
 * GitHub App / token configurations omit it) does NOT block the flow, since
 * a false positive here would incorrectly deny a user who can actually push.
 * The real enforcement remains GitHub's own API on the write call itself.
 */
async function hasPushAccess({ owner, repo, accessToken, log }) {
    try {
        const { data } = await githubApi(`/repos/${owner}/${repo}`, accessToken);
        return { push: data?.permissions?.push !== false, repoData: data };
    } catch (e) {
        log?.warn?.({ err: e, owner, repo }, 'Diagram embed: repo permissions fetch failed');
        return { push: true, repoData: null };
    }
}

router.post('/ai/generate-diagram/embed-preview', requireAuth, validateBody(embedDiagramPreviewSchema), async (req, res) => {
    const { repo, diagramType, target, mermaid, svg, placement, customAnchor, truncated } = req.validatedBody;
    if (!isValidGitHubFullName(repo.full_name)) {
        return res.status(400).json({ error: 'Invalid repo.full_name', code: 'validation_failed' });
    }
    const [owner, repoName] = repo.full_name.split('/');

    try {
        const { push } = await hasPushAccess({ owner, repo: repoName, accessToken: req.session.accessToken, log: req.log });
        const readme = await fetchFullReadme({ owner, repo: repoName, accessToken: req.session.accessToken, log: req.log });
        // `readme.truncated` means a README file exists but GitHub couldn't
        // inline it (too large/binary) — distinct from no README at all, so it
        // must not fall into the "create one first" branch below.
        const readmeTruncated = !!readme?.truncated;
        const hasReadme = !!readme && !readmeTruncated;

        if (target === 'readme-mermaid') {
            if (readmeTruncated) {
                return res.json({
                    success: true, target, hasReadme: false, readmeTruncated: true, readOnly: !push,
                    notice: 'A README exists but is too large or binary to read — embed as a committed SVG file instead, or replace the README first.',
                });
            }
            if (!hasReadme) {
                return res.json({
                    success: true, target, hasReadme: false, readOnly: !push,
                    notice: 'No README found — create one first (README Studio), or embed as a committed SVG file instead.',
                });
            }
            const block = buildMermaidEmbedBlock({ type: diagramType, mermaid, truncated });
            const { content, action, notice } = insertOrReplaceBlock(readme.content, diagramType, block, { placement, customAnchor });
            return res.json({
                success: true, target, hasReadme: true, readOnly: !push, action, notice,
                readme: { path: readme.path, before: readme.content, after: content, commitMessage: `docs: embed ${diagramType} diagram in README` },
            });
        }

        // target === 'svg-file'
        const sanitized = sanitizeSvg(svg);
        if (!sanitized.ok) {
            return res.status(422).json({ error: `Generated SVG failed validation (${sanitized.reason}) and cannot be embedded.`, code: 'invalid_svg' });
        }
        const path = svgPathFor(diagramType);

        let readmeResult = null;
        if (hasReadme) {
            const block = buildSvgRefEmbedBlock({ type: diagramType, svgPath: path, label: diagramLabel(diagramType), truncated });
            const { content, action, notice } = insertOrReplaceBlock(readme.content, diagramType, block, { placement, customAnchor });
            readmeResult = { path: readme.path, before: readme.content, after: content, action, notice, commitMessage: `docs: reference ${diagramType} diagram SVG in README` };
        }

        res.json({
            success: true, target, hasReadme, readmeTruncated, readOnly: !push,
            svg: { path, content: sanitized.svg, commitMessage: `docs: add ${diagramType} diagram SVG` },
            readme: readmeResult,
            notice: readmeTruncated
                ? 'A README exists but is too large or binary to read — the diagram SVG will be committed to docs/diagrams/ without a README reference.'
                : (!hasReadme ? 'No README found — the diagram SVG will be committed to docs/diagrams/ without a README reference.' : (readmeResult?.notice || null)),
        });
    } catch (error) {
        req.log.error({ err: error, repo: repo.full_name }, 'Diagram embed preview failed');
        res.status(500).json({ error: 'Failed to build the diagram embed preview. Please try again later.', code: 'embed_preview_failed' });
    }
});

router.post('/ai/generate-diagram/embed-commit', requireAuth, validateBody(embedDiagramCommitSchema), async (req, res) => {
    const { repo, diagramType, target, readme, svg, mode } = req.validatedBody;
    if (!isValidGitHubFullName(repo.full_name)) {
        return res.status(400).json({ error: 'Invalid repo.full_name', code: 'validation_failed' });
    }
    // Defence in depth: never trust client-echoed paths from preview. The SVG
    // path is fully derivable from diagramType; the README path must be an
    // actual README file with no traversal.
    if (svg && svg.path !== svgPathFor(diagramType)) {
        return res.status(400).json({ error: `svg.path must be ${svgPathFor(diagramType)} for this diagram type.`, code: 'validation_failed' });
    }
    if (readme && (!/(^|\/)README\.md$/i.test(readme.path) || readme.path.includes('..') || readme.path.startsWith('/'))) {
        return res.status(400).json({ error: 'readme.path must be a README.md path inside the repository.', code: 'validation_failed' });
    }
    const [owner, repoName] = repo.full_name.split('/');

    try {
        const { push } = await hasPushAccess({ owner, repo: repoName, accessToken: req.session.accessToken, log: req.log });
        if (!push) {
            return res.status(403).json({ error: 'You do not have push access to this repository — a pull request cannot be opened on your behalf (PR-from-fork is not supported).', code: 'read_only_access' });
        }

        const results = {};

        if (svg) {
            // Defence in depth: re-validate at commit time too, in case a
            // caller skipped embed-preview.
            const sanitized = sanitizeSvg(svg.content);
            if (!sanitized.ok) {
                return res.status(422).json({ error: `Generated SVG failed validation (${sanitized.reason}) and cannot be committed.`, code: 'invalid_svg' });
            }
            results.svg = await commitOrOpenPR({
                owner, repo: repoName, token: req.session.accessToken,
                filePath: svg.path, content: sanitized.svg, commitMessage: svg.commitMessage, mode, githubApi,
            });
        }

        if (readme) {
            results.readme = await commitOrOpenPR({
                owner, repo: repoName, token: req.session.accessToken,
                filePath: readme.path, content: readme.content, commitMessage: readme.commitMessage, mode, githubApi,
            });
        }

        auditLog(req, 'ai.embed_diagram', 'repo', `${owner}/${repoName}`, { target, mode });
        res.json({ success: true, target, ...results });
    } catch (error) {
        req.log.error({ err: error, repo: repo.full_name }, 'Diagram embed commit failed');
        res.status(500).json({ error: 'Failed to commit the diagram embed. Please try again later.', code: 'embed_commit_failed' });
    }
});

export default router;
