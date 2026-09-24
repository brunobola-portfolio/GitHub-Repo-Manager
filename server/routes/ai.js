/*
 * GitHub Repo Manager - AI Routes (Barrel)
 *
 * This file is a thin composition layer. All handler logic lives in the
 * sub-routers under server/routes/ai/. The default export is preserved so
 * every existing `import aiRouter from '../routes/ai.js'` call site (and
 * every `await import('../routes/ai.js')` in tests) keeps working.
 *
 * Sub-routers:
 *   - ./ai/core.js                     — status + chat + suggest + readme + readme/enhance
 *   - ./ai/indexing.js                 — index + search + metadata + batch-index
 *   - ./ai/dev-toolkit.js              — quality-report + review-summary + generate-commit
 *                                        + generate-pr + refine + analyze-context + chat-refine
 *   - ./ai/migration.js                — issue-to-plan + migration-risk + migration-size-strategy
 *                                        + migration-description
 *   - ./ai/suggest-name-description.js — suggest-name-description
 *   - ./ai/prompts.js                  — list / set / clear user prompt overrides
 *   - ./ai/diagrams.js                 — generate-diagram (Mermaid, retry-once self-repair)
 *                                        + deterministic fallback + embed-into-repo (Addendum 6b.1)
 *   - ./ai/images.js                   — generate-image (repo-grounded raster banners/logos, r5)
 *                                        + capability check + preview-before-commit
 *
 * Shared helpers (requireAI, handleAIError, providerGenerateWithRetry) live
 * in ./ai/shared.js and are imported by each sub-router.
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 */

import express from 'express';
import coreRouter from './ai/core.js';
import indexingRouter from './ai/indexing.js';
import devToolkitRouter from './ai/dev-toolkit.js';
import migrationRouter from './ai/migration.js';
import suggestNameDescriptionRouter from './ai/suggest-name-description.js';
import promptsRouter from './ai/prompts.js';
import diagramsRouter from './ai/diagrams.js';
import imagesRouter from './ai/images.js';
import deepReviewRouter from './ai/deep-review.js';
import promptStudioRouter from './ai/prompt-studio.js';
import prCommandsRouter from './ai/pr-commands.js';
import prChatRouter from './ai/pr-chat.js';

const router = express.Router();
router.use(coreRouter);
router.use(indexingRouter);
router.use(devToolkitRouter);
router.use(migrationRouter);
router.use(suggestNameDescriptionRouter);
router.use(promptsRouter);
router.use(diagramsRouter);
router.use(imagesRouter);
// Prefixed sub-routers. Exported so the scope parity gate
// (ai-key-scope-enforcement.test.js) can see their routes WITH the prefix and
// hold their requireScope('ai') mounts against AI_GENERATION_ROUTE_PATTERNS.
//   deep-review   — draft lifecycle (generate / get / patch / publish / delete)
//   prompt-studio — preset library + sandbox /test for the Deep Review prompt
//   pr-commands   — /describe, /test_plan, /improve (describe can PATCH the PR)
//   pr-chat       — streaming Q&A about a PR with persisted history
export const AI_PREFIXED_ROUTERS = Object.freeze([
    ['/ai/deep-review', deepReviewRouter],
    ['/ai/prompt-studio', promptStudioRouter],
    ['/ai/pr-commands', prCommandsRouter],
    ['/ai/pr-chat', prChatRouter],
]);
// Mounted one call each, not in a loop over the list above: CodeQL cannot
// follow a loop-mounted router back to the app-level rate limiters, and
// flagged every route in these four files as unthrottled. The scope test
// checks that each listed router really is mounted.
router.use('/ai/deep-review', deepReviewRouter);
router.use('/ai/prompt-studio', promptStudioRouter);
router.use('/ai/pr-commands', prCommandsRouter);
router.use('/ai/pr-chat', prChatRouter);

export default router;
