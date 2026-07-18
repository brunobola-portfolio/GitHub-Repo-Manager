/*
 * GitHub Repo Manager - AI Diagram Generator Route
 *
 * Endpoints:
 *   POST /ai/generate-diagram
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
 */

import express from 'express';
import { githubApi } from '../../lib/github-api.js';
import { requireAuth, isValidGitHubFullName } from '../../middleware/auth.js';
import { requireScope } from '../../middleware/api-key-auth.js';
import { validateBody } from '../../middleware/validate-request.js';
import { aiGenerateDiagramSchema } from '../../lib/validators.js';
import { sanitizeForPrompt } from '../../ai-service.js';
import { checkAIFeatureLimit, incrementAIUsage, quotaExceededResponse } from '../../lib/usage-meter.js';
import { auditLog } from '../../lib/audit.js';
import { requireAI, guardedGenerate, handleAIError, denyIfSpendCapReached, recordStreamCompletion } from './shared.js';
import { initSSE, streamToSSEWithUsage } from '../ai-streaming.js';
import { resolveMaxOutputTokens } from '../../lib/ai-output-budget.js';

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
async function fetchDiagramContext({ owner, repo, accessToken, log }) {
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

export default router;
