/*
 * GitHub Repo Manager - AI Routes (Barrel)
 *
 * This file is a thin composition layer. All handler logic lives in the
 * sub-routers under server/routes/ai/. The default export is preserved so
 * every existing `import aiRouter from '../routes/ai.js'` call site (and
 * every `await import('../routes/ai.js')` in tests) keeps working.
 *
 * Sub-routers:
 *   - ./ai/core.js        — status + chat + suggest + readme + readme/enhance
 *   - ./ai/indexing.js    — index + search + metadata + batch-index
 *   - ./ai/dev-toolkit.js — quality-report + review-summary + generate-commit
 *                           + generate-pr + refine + analyze-context + chat-refine
 *   - ./ai/migration.js   — issue-to-plan + migration-risk + migration-size-strategy
 *                           + migration-description
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

const router = express.Router();
router.use(coreRouter);
router.use(indexingRouter);
router.use(devToolkitRouter);
router.use(migrationRouter);

export default router;
