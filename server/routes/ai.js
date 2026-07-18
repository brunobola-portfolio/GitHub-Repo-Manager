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
// Deep Review: full draft lifecycle (generate / get / patch / publish / delete).
// Mounted under /api/ai/deep-review/* — keeps the engine + store + publish
// builder behind a single namespace the frontend can hit.
router.use('/ai/deep-review', deepReviewRouter);
// Prompt Studio (slice 1b): preset library + sandbox /test for the Deep
// Review system prompt. GETs are free; mutations + /test are Pro-gated.
router.use('/ai/prompt-studio', promptStudioRouter);
// PR slash commands (slice 3 — Pro): /describe, /test_plan, /improve.
// Generates structured PR-context artifacts and (for /describe) PATCHes the
// PR body via GitHub. All endpoints are Pro-gated.
router.use('/ai/pr-commands', prCommandsRouter);
// PR chat (slice 2 — Pro): streaming Q&A about a PR with persisted history.
// Uses SSE on POST and JSON on GET / DELETE. Pro-gated.
router.use('/ai/pr-chat', prChatRouter);

export default router;
