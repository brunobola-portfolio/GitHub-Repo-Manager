/*
 * GitHub Repo Manager - Repository Routes (Barrel)
 *
 * This file is a thin composition layer. All handler logic lives in the
 * sub-routers under server/routes/repos/. The default export is preserved so
 * every existing `import reposRouter from '../routes/repos.js'` call site
 * (and every `await import('../routes/repos.js')` in tests) keeps working.
 *
 * Sub-routers:
 *   - ./repos/crud.js               — list/create/get/update repos, topics,
 *                                     forks, collaborators, contents, README,
 *                                     labels, commits, compare
 *   - ./repos/pulls.js              — pull requests (CRUD, merge, reviews,
 *                                     files, diff, inline comments, replies).
 *                                     Write-back endpoints are free on every
 *                                     tier (locked by pr-write-tier-gate.test.js).
 *   - ./repos/issues.js             — issues + issue comments
 *   - ./repos/branches-releases.js  — branches, branch protection, tags, releases
 *   - ./repos/actions-community.js  — webhooks, GitHub Actions, community
 *                                     health, CODEOWNERS + suggest, PR
 *                                     template, commit-style detector
 *
 * Each sub-router replicates the `router.param('owner', ...)` and
 * `router.param('repo', ...)` validators — Express param validators are
 * router-local, so replicating them keeps each sub-file self-contained.
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 */

import express from 'express';
import crudRouter from './repos/crud.js';
import pullsRouter from './repos/pulls.js';
import issuesRouter from './repos/issues.js';
import commitsRouter from './repos/commits.js';
import branchesReleasesRouter from './repos/branches-releases.js';
import actionsCommunityRouter from './repos/actions-community.js';
import treeRouter from './repos/tree.js';

const router = express.Router();

router.use(crudRouter);
router.use(pullsRouter);
router.use(issuesRouter);
router.use(commitsRouter);
router.use(branchesReleasesRouter);
router.use(actionsCommunityRouter);
router.use(treeRouter);

export default router;
