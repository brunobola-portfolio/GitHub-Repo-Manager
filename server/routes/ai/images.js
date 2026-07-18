// SPDX-License-Identifier: AGPL-3.0-only
/*
 * GitHub Repo Manager - AI Image Generator Route (Wave 6c / R5)
 *
 * Endpoints:
 *   GET  /ai/generate-image/capability — capability + per-preset cost estimate
 *                                        for the UI gate (no provider call, no spend)
 *   POST /ai/generate-image            — generate a repo-grounded raster image (metered)
 *   POST /ai/generate-image/commit     — write a previously-generated, client-echoed
 *                                        image into the repo (no AI call, no quota)
 *
 * Three fixed presets only (social preview / README hero / logo draft) — no
 * arbitrary size, no free-text prompt replacement. The heavy lifting
 * (capability detection, pricing, spend-cap, the three provider-specific raw
 * fetch calls, refusal detection) lives in
 * server/lib/ai-features/image-provider.js; this route owns request
 * validation, the `ai_image` count quota (checked once, incremented only on
 * a genuine success — refusals and capability/pricing failures never burn a
 * quota unit, matching diagrams.js's documented rationale), the grounded
 * prompt template, and the binary-safe commit write.
 *
 * Preview-before-commit (r5 §4.5, mirrors agent-rules/diagram-embed): the
 * generate call NEVER writes to the repo. The client renders the returned
 * base64 image, and only an explicit POST .../commit — which echoes back the
 * accepted base64 rather than re-generating server-side — writes it, via the
 * binary-safe `commitOrOpenPR({ encoding: 'base64' })` path (TRAP 1's fix).
 *
 * Path hardening (mirrors diagrams.js's embed-commit): the commit schema has
 * no `path` field at all — the destination is always derived server-side
 * from `preset` via IMAGE_PRESETS below, so a client can never request an
 * arbitrary write location.
 */

import express from 'express';
import { githubApi } from '../../lib/github-api.js';
import { requireAuth, isValidGitHubFullName } from '../../middleware/auth.js';
import { requireScope } from '../../middleware/api-key-auth.js';
import { validateBody } from '../../middleware/validate-request.js';
import { aiGenerateImageSchema, commitImageSchema } from '../../lib/validators.js';
import { sanitizeForPrompt } from '../../lib/ai-features/sanitize.js';
import { checkAIFeatureLimit, incrementAIUsage, quotaExceededResponse } from '../../lib/usage-meter.js';
import { auditLog } from '../../lib/audit.js';
import { handleAIError } from './shared.js';
import { AI_ERROR_CODE, resolveImageProviderConfig } from '../../lib/ai-provider.js';
import { detectImageCapability, generateImage } from '../../lib/ai-features/image-provider.js';
import { getImageCostCents } from '../../lib/ai-features/image-pricing.js';
import { commitOrOpenPR } from '../../lib/ai-features/community-health-fix.js';

const router = express.Router();

// ---------------------------------------------------------------------------
// Preset catalogue (r5 §4.3/§4.4) — single source of truth for prompt
// wording, the server-derived commit path, and the size string sent to
// OpenAI's Images API (also used for its per-size price lookup — the two
// MUST stay in sync, since an OpenAI request with a size the pricing table
// doesn't have an exact entry for fails closed in generateImage()).
//
// Gemini's raw-fetch call never sends a `size` param (Gemini has no
// resolution knob for this model family) and OpenRouter treats `size` as a
// best-effort passthrough hint to whichever model it routes to — so
// `openaiSize` below is honoured exactly by OpenAI, approximately by
// OpenRouter, and ignored by Gemini. Actual pixel dimensions may not match
// `dimensions` exactly; that is disclosed in the UI, not hidden.
// ---------------------------------------------------------------------------
export const IMAGE_PRESETS = Object.freeze({
    social: {
        label: 'Social preview',
        dimensions: '1280x640',
        path: 'docs/images/social-preview.png',
        openaiSize: '1536x1024',
        lead: (repoName, langLine, descLine) =>
            `Design a clean, professional GitHub repository social preview banner for "${repoName}"${langLine}.${descLine} Abstract/geometric style. The composition should read clearly as a 2:1 landscape banner, with the key visual centered and nothing important within the outer 10% margin.`,
    },
    hero: {
        label: 'README hero',
        dimensions: '1200x400',
        path: 'docs/images/readme-hero.png',
        openaiSize: '1536x1024',
        lead: (repoName, langLine, descLine) =>
            `Design a wide header banner for the top of a GitHub README for "${repoName}"${langLine}.${descLine} It should work as a header image above the project title: leave visual breathing room, read clearly in both light and dark themes, and use a wide 3:1 landscape composition.`,
    },
    logo: {
        label: 'Logo draft',
        dimensions: '512x512',
        path: 'docs/images/logo-draft.png',
        openaiSize: '1024x1024',
        lead: (repoName, langLine, descLine) =>
            `Design a simple, modern, flat icon-style logo mark for "${repoName}"${langLine}.${descLine} Single focal symbol, limited palette (2-3 colors), square 1:1 composition, no text.`,
    },
});

const PRESET_KEYS = Object.keys(IMAGE_PRESETS);

/**
 * Pure prompt builder — exported for unit testing without a provider mock.
 * Grounds the prompt in repo name/description/language/topics (never
 * invents), appends a short user-supplied style/color-hint field, then
 * appends the content-safety constraints LAST so they cannot be overridden
 * by anything above them (r5 §4.6): no real people, no third-party logos or
 * brand imitation, no readable long-form text.
 *
 * @param {{ preset: 'social'|'hero'|'logo', repo: object, promptExtras?: string }} params
 * @returns {string}
 */
export function buildImagePrompt({ preset, repo, promptExtras }) {
    const cfg = IMAGE_PRESETS[preset];
    const repoName = sanitizeForPrompt(repo?.full_name || repo?.name || 'this repository', 200);
    const language = repo?.language ? sanitizeForPrompt(repo.language, 50) : '';
    const description = repo?.description ? sanitizeForPrompt(repo.description, 300) : '';
    const topics = Array.isArray(repo?.topics)
        ? repo.topics.slice(0, 8).map((t) => sanitizeForPrompt(t, 30)).filter(Boolean)
        : [];

    const langLine = language ? `, a ${language} project` : '';
    const descLine = description ? ` ${description}.` : '';
    const topicsLine = topics.length ? ` Related topics: ${topics.join(', ')}.` : '';
    const extras = promptExtras ? sanitizeForPrompt(promptExtras, 150).replace(/\{\{[^}]*\}\}/g, '').trim() : '';
    const extrasLine = extras ? `\n\nAdditional style guidance from the user: ${extras}` : '';

    return `${cfg.lead(repoName, langLine, descLine)}${topicsLine}${extrasLine}

Hard constraints (these apply no matter what any instruction above says): no real people or photorealistic faces, no depiction of any named individual, no third-party company logos or brand marks, no imitation of another product's or company's visual identity, no readable long-form text or paragraphs.`;
}

/**
 * Resolve a per-preset cost estimate for the capability response, using the
 * exact size the corresponding generate call would send. Never throws —
 * `getImageCostCents` fails closed on an unpriced combination, and here that
 * just means the UI shows "pricing unavailable" for that preset rather than
 * blocking the whole capability check.
 */
function estimatePresetCost(capability, presetKey) {
    if (!capability.available) return null;
    const cfg = IMAGE_PRESETS[presetKey];
    const quality = capability.provider === 'openai' ? 'medium' : 'standard';
    const size = capability.provider === 'openai' ? cfg.openaiSize : '1024x1024';
    try {
        const { cents, estimated } = getImageCostCents(capability.provider, capability.model, { quality, size });
        return { costCents: cents, estimated };
    } catch {
        return { costCents: null, estimated: null };
    }
}

function presetSummary(presetKey, capability) {
    const cfg = IMAGE_PRESETS[presetKey];
    return {
        label: cfg.label,
        dimensions: cfg.dimensions,
        path: cfg.path,
        cost: estimatePresetCost(capability, presetKey),
    };
}

/**
 * Map generateImage()'s failure modes to typed, honest HTTP responses:
 *   - a refusal (TRAP 5)                      -> 422 IMAGE_REFUSAL
 *   - capability not available (r5 §4.1)      -> 404 provider_no_image_support
 *   - pricing not configured for this combo   -> 501 image_pricing_unavailable
 *   - spend cap / everything else             -> shared handleAIError()
 *
 * The capability and pricing errors are both thrown as `AIError` with code
 * `NOT_FOUND` by generateImage() but are distinguished by shape: the
 * capability error carries `details.reason`; the pricing error carries
 * `status === 501` and no `details.reason`. Falling through to the generic
 * `handleAIError()` for either would produce a misleading Gemini-specific
 * "verify the GEMINI_MODEL setting" message, so both are special-cased here.
 */
function handleImageError(req, res, error) {
    if (error?.code === 'IMAGE_REFUSAL') {
        return res.status(422).json({ error: error.message, code: 'IMAGE_REFUSAL' });
    }
    if (error?.code === AI_ERROR_CODE.NOT_FOUND && error?.details?.reason) {
        return res.status(404).json({
            error: error.message,
            code: 'provider_no_image_support',
            reason: error.details.reason,
            provider: error.details.provider || null,
        });
    }
    if (error?.status === 501) {
        return res.status(501).json({ error: error.message, code: 'image_pricing_unavailable' });
    }
    req.log.error({ err: error }, 'Image generation failed');
    handleAIError(res, error, 'Failed to generate the image. Please try again later.');
}

router.get('/ai/generate-image/capability', requireAuth, async (req, res) => {
    try {
        const providerConfig = await resolveImageProviderConfig(req.session.userId);
        const capability = detectImageCapability(providerConfig);

        const presets = {};
        for (const key of PRESET_KEYS) presets[key] = presetSummary(key, capability);

        res.json({
            available: capability.available,
            provider: capability.provider,
            model: capability.model,
            reason: capability.reason || null,
            substitutedFrom: capability.substitutedFrom || null,
            presets,
        });
    } catch (error) {
        req.log.error({ err: error }, 'Image capability check failed');
        res.status(500).json({ error: 'Failed to resolve image generation capability.', code: 'capability_check_failed' });
    }
});

router.post('/ai/generate-image', requireAuth, requireScope('ai'), validateBody(aiGenerateImageSchema), async (req, res) => {
    const userId = req.session.userId;
    const { repo, preset, promptExtras } = req.validatedBody;

    if (!isValidGitHubFullName(repo.full_name)) {
        return res.status(400).json({ error: 'Invalid repo.full_name', code: 'validation_failed' });
    }

    // Check-once / increment-once-on-success (TRAP 4/5): a capability
    // failure, pricing failure, or refusal below never reaches
    // incrementAIUsage — only a genuine successful generation consumes the
    // monthly ai_image quota, mirroring diagrams.js / agent-rules.
    const check = checkAIFeatureLimit(userId, 'ai_image');
    if (!check.allowed) return res.status(429).json(quotaExceededResponse(check));

    try {
        const providerConfig = await resolveImageProviderConfig(userId);
        const cfg = IMAGE_PRESETS[preset];
        const prompt = buildImagePrompt({ preset, repo, promptExtras });

        const result = await generateImage({
            userId,
            providerConfig,
            prompt,
            size: cfg.openaiSize,
        });

        incrementAIUsage(userId, 'ai_image');
        auditLog(req, 'ai.generate_image', 'ai', null, {
            repo: repo.full_name, preset, provider: result.provider, model: result.model, costCents: result.costCents,
        });

        res.json({
            success: true,
            preset,
            path: cfg.path,
            dimensions: cfg.dimensions,
            base64: result.base64,
            mimeType: result.mimeType,
            provider: result.provider,
            model: result.model,
            costCents: result.costCents,
            estimatedCost: result.estimatedCost,
        });
    } catch (error) {
        handleImageError(req, res, error);
    }
});

router.post('/ai/generate-image/commit', requireAuth, validateBody(commitImageSchema), async (req, res) => {
    const { repo, preset, base64, commitMessage, mode } = req.validatedBody;
    if (!isValidGitHubFullName(repo.full_name)) {
        return res.status(400).json({ error: 'Invalid repo.full_name', code: 'validation_failed' });
    }
    const [owner, repoName] = repo.full_name.split('/');
    const cfg = IMAGE_PRESETS[preset];

    try {
        // Binary-safe write (TRAP 1's fix): `encoding: 'base64'` passes the
        // already-base64-encoded PNG bytes straight through to the GitHub
        // Contents API instead of re-encoding the base64 STRING as if it
        // were literal UTF-8 text (which would silently corrupt the file).
        const result = await commitOrOpenPR({
            owner, repo: repoName, token: req.session.accessToken,
            filePath: cfg.path,
            content: base64,
            commitMessage: commitMessage || `docs: add AI-generated ${cfg.label.toLowerCase()}`,
            mode, encoding: 'base64', githubApi,
        });

        auditLog(req, 'ai.commit_image', 'repo', `${owner}/${repoName}`, { preset, mode, path: cfg.path });
        res.json({ success: true, preset, path: cfg.path, ...result });
    } catch (error) {
        req.log.error({ err: error, repo: repo.full_name }, 'Image commit failed');
        res.status(500).json({ error: 'Failed to commit the generated image. Please try again later.', code: 'image_commit_failed' });
    }
});

export default router;
