// SPDX-License-Identifier: Apache-2.0
/**
 * B-09 — routes outside the /api{,/v1}/ai/* barrel that still invoke an LLM
 * (directly via guardedGenerate, or indirectly through a lib/ai-features/*
 * helper that calls it) and must therefore carry the same tenant `ai`
 * rate-limit bucket the barrel gets from `app.use('/api/ai/', aiLimiter)` /
 * `app.use('/api/v1/ai/', aiLimiter)` in server/index.js. Without this, each
 * fell back to the much looser `api` bucket (500/15min on Pro vs 50 for
 * `ai`).
 *
 * These are the same four routes server/middleware/api-key-auth.js's
 * AI_GENERATION_ROUTE_PATHS comment already tracks as "outside the ai
 * barrel" for the requireScope('ai') carve-out (see
 * server/__tests__/ai-key-scope-enforcement.test.js) — this list exists
 * because rate-limit coverage and scope-carve-out coverage are two different
 * invariants that happen to apply to the same route set today, not because
 * one implies the other.
 *
 * Exported so server/index.js can mount the SAME limiter instance on these
 * exact paths, and so server/__tests__/ai-rate-limit-coverage.test.js can
 * assert the mount actually reaches each one.
 */
export const AI_BUCKET_EXTRA_ROUTE_PATHS = Object.freeze([
    '/migration/analyze',
    '/repos/:owner/:repo/agent-rules/generate',
    '/repos/:owner/:repo/security/summary',
    '/work-board/ai-summary',
]);

// Both the back-compat (/api/*) and v1 (/api/v1/*) mounts — same convention
// AI_GENERATION_ROUTE_PATHS uses in server/middleware/api-key-auth.js.
export const AI_BUCKET_EXTRA_EXPRESS_PATHS = Object.freeze(
    AI_BUCKET_EXTRA_ROUTE_PATHS.flatMap((p) => [`/api${p}`, `/api/v1${p}`])
);
