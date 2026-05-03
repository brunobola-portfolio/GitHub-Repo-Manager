// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AI Deep Review prompt resolver.
 *
 * Picks the active preset for one generate call by composing:
 *   1. The base `pr_deep_review` system prompt (from `ai-prompt-registry`),
 *      rendered with PR-scoped variables.
 *   2. The active preset body (built-in, explicit user preset, repo default,
 *      user default, or general fallback).
 *   3. Repo-level `${REPO_STYLE_GUIDE}` token substitution from
 *      `.repomanager/review-rules.md` when the preset references it.
 *
 * `path_rules` are returned unfiltered — the engine applies them per file.
 */
import { BUILTIN_PRESETS, isBuiltinKey } from './builtin-prompts.js';
import { getResolvedPrompt } from '../ai-prompt-registry.js';
import { getPresetById, getDefaultForScope, getOrgDefaultForScope } from '../ai-prompt-store.js';
import { readThrough } from '../gh-cache.js';
import { githubApi } from '../github-api.js';
import { getCurrentUserOrgs, filterOrgsByMembership } from '../github-org-membership.js';
import logger from '../logger.js';

const STYLE_GUIDE_TOKEN = '${REPO_STYLE_GUIDE}';
const STYLE_GUIDE_PATH = '.repomanager/review-rules.md';
const STYLE_GUIDE_TTL_MS = 60 * 60 * 1000; // 1 h — review-rules.md changes rarely

/**
 * Resolve which prompt to use for an AI Deep Review generate call.
 *
 * Resolution order:
 *  1. Explicit `presetKey`:
 *     - Built-in key (general/security/...)        → BUILTIN_PRESETS[key]
 *     - Numeric id of an owned preset              → store row
 *     - Anything else                              → throws PRESET_NOT_FOUND
 *  2. Repo-scoped default for `(userId, 'repo', '${owner}/${name}')`.
 *  3. User-scoped default for `(userId, 'user', null)`.
 *  4. Org-scoped default for any org the session user is an active member of
 *     (alphabetic-first when multiple orgs have defaults — stable tie-break).
 *  5. Fallback: BUILTIN_PRESETS.general.
 *
 * @returns {Promise<{
 *   name: string,
 *   systemPrompt: string,
 *   severityFloor: 'info'|'suggestion'|'warning'|'critical'|null,
 *   pathRules: Array<{glob:string, extraPrompt:string}>,
 *   source: string,
 * }>}
 */
export async function resolvePromptForGenerate(ctx) {
    const { userId, repoOwner, repoName, presetKey, session } = ctx;
    const repoFullName = `${repoOwner}/${repoName}`;

    let preset;
    let source;

    if (presetKey != null && presetKey !== '') {
        const keyStr = String(presetKey);
        if (isBuiltinKey(keyStr)) {
            const b = BUILTIN_PRESETS[keyStr];
            preset = { name: b.name, body: b.body, severityFloor: b.severityFloor, pathRules: [] };
            source = `preset:${keyStr}`;
        } else {
            const numericId = Number(presetKey);
            if (!Number.isFinite(numericId) || !Number.isInteger(numericId) || numericId <= 0) {
                const err = new Error(`Unknown preset key: ${presetKey}`);
                err.code = 'PRESET_NOT_FOUND';
                throw err;
            }
            const row = getPresetById(userId, numericId);
            if (!row) {
                const err = new Error(`Preset ${numericId} not found or not owned by user`);
                err.code = 'PRESET_NOT_FOUND';
                throw err;
            }
            preset = {
                name: row.name,
                body: row.systemPrompt,
                severityFloor: row.severityFloor,
                pathRules: row.pathRules,
            };
            source = `user:${row.id}`;
        }
    } else {
        const repoDefault = getDefaultForScope(userId, 'repo', repoFullName);
        if (repoDefault) {
            preset = {
                name: repoDefault.name,
                body: repoDefault.systemPrompt,
                severityFloor: repoDefault.severityFloor,
                pathRules: repoDefault.pathRules,
            };
            source = `repo-default:${repoDefault.id}`;
        } else {
            const userDefault = getDefaultForScope(userId, 'user', null);
            if (userDefault) {
                preset = {
                    name: userDefault.name,
                    body: userDefault.systemPrompt,
                    severityFloor: userDefault.severityFloor,
                    pathRules: userDefault.pathRules,
                };
                source = `user-default:${userDefault.id}`;
            } else {
                // Org-scoped default — only consult when no user/repo default
                // is set. We list the user's GitHub orgs and pick the first
                // (alphabetic) org that has a row marked as default. Sequential
                // check keeps the cost bounded; both the org list and per-org
                // membership are cached for 5 minutes via gh-cache.
                const orgDefault = await resolveOrgDefault({ session });
                if (orgDefault) {
                    preset = {
                        name: orgDefault.row.name,
                        body: orgDefault.row.systemPrompt,
                        severityFloor: orgDefault.row.severityFloor,
                        pathRules: orgDefault.row.pathRules,
                    };
                    source = `org-default:${orgDefault.org}:${orgDefault.row.id}`;
                } else {
                    const b = BUILTIN_PRESETS.general;
                    preset = { name: b.name, body: b.body, severityFloor: b.severityFloor, pathRules: [] };
                    source = 'fallback';
                }
            }
        }
    }

    // Base system prompt from the user-overridable pr_deep_review registry entry.
    // The active preset body is appended below — never replaces the JSON output
    // schema or line-comment cap defined in the base prompt.
    const basePrompt = getResolvedPrompt(userId, 'pr_deep_review', {
        repo_full_name: repoFullName,
        pr_title: ctx.prTitle ?? '',
        author: ctx.author ?? '',
    });

    const safeName = String(preset.name || '').replace(/[\r\n]+/g, ' ').trim();
    let systemPrompt = `${basePrompt}\n\n--- Active preset: ${safeName} ---\n${preset.body}`;

    // ${REPO_STYLE_GUIDE} substitution. We only pay the GitHub round-trip when
    // the preset body actually references the token.
    if (systemPrompt.includes(STYLE_GUIDE_TOKEN)) {
        const styleGuide = await fetchRepoStyleGuide({ session, userId, repoOwner, repoName });
        systemPrompt = systemPrompt.split(STYLE_GUIDE_TOKEN).join(styleGuide);
    }

    return {
        name: preset.name,
        systemPrompt,
        severityFloor: preset.severityFloor,
        pathRules: preset.pathRules || [],
        source,
    };
}

/**
 * Fetch and decode `.repomanager/review-rules.md` from the repo. Returns ''
 * on any failure (404 for "no style guide", network/auth errors). Cached for
 * one hour via gh-cache so a hot loop of generate calls hits GitHub at most
 * once per repo per hour.
 */
async function fetchRepoStyleGuide({ session, userId, repoOwner, repoName }) {
    if (!session?.accessToken) return '';
    try {
        const { data } = await readThrough({
            userId: session.userId ?? userId,
            resourceType: 'repo-content',
            resourceKey: `${repoOwner}/${repoName}/${STYLE_GUIDE_PATH}`,
            ttlMs: STYLE_GUIDE_TTL_MS,
            fetcher: ({ ifNoneMatch }) => githubApi(
                `/repos/${repoOwner}/${repoName}/contents/${STYLE_GUIDE_PATH}`,
                session.accessToken,
                ifNoneMatch ? { headers: { 'If-None-Match': ifNoneMatch } } : {},
            ),
        });
        if (data?.content) {
            const decoded = Buffer.from(data.content, 'base64').toString('utf-8');
            // Cap at 16KB so a runaway style-guide doesn't balloon prompt cost.
            // 16KB matches 2× the system_prompt zod cap (8KB) — generous headroom.
            const MAX_STYLE_GUIDE_CHARS = 16 * 1024;
            if (decoded.length > MAX_STYLE_GUIDE_CHARS) {
                return decoded.slice(0, MAX_STYLE_GUIDE_CHARS) + '\n\n[truncated — style guide exceeded 16KB cap]';
            }
            return decoded;
        }
        return '';
    } catch (err) {
        // Expected miss case (404 = no style guide checked in). Never warn —
        // the absence of the file is the common path.
        logger.debug(
            { err: err?.message, repoOwner, repoName },
            'Style guide not present or fetch failed',
        );
        return '';
    }
}

/**
 * Find the first org-scoped default visible to the session user. Returns
 * `{org, row}` for the winning org or null.
 *
 * "First" = alphabetic by org login, so the choice is stable when a user
 * belongs to multiple orgs that each have an org default. Each membership
 * check goes through the 5-minute gh-cache, so the hot-loop cost is one
 * cheap SQL hit per org per 5 min.
 */
async function resolveOrgDefault({ session }) {
    if (!session?.userId || !session?.accessToken) return null;
    const orgs = await getCurrentUserOrgs({ session });
    if (orgs.length === 0) return null;
    const visibleOrgs = await filterOrgsByMembership({ session, orgs });
    if (visibleOrgs.length === 0) return null;
    const sorted = visibleOrgs.slice().sort();
    for (const org of sorted) {
        const row = getOrgDefaultForScope(org);
        if (row) return { org, row };
    }
    return null;
}

export const _internals = { fetchRepoStyleGuide, resolveOrgDefault };
