/*
 * GitHub Repo Manager - Repo Tree Route
 *
 * GET /api/repos/:owner/:name/tree?branch=...
 *
 * Wraps GitHub's recursive git-tree endpoint after resolving the branch
 * SHA. Returns a flat list of blob entries (no tree nodes — the file
 * picker has no use for them) capped at 500. The cap is independent of
 * GitHub's own `truncated` flag; both contribute to the response's
 * `truncated` field.
 */

import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { githubApi } from '../../lib/github-api.js';
import logger from '../../lib/logger.js';

const router = express.Router();
const MAX_ENTRIES = 500;

router.get('/api/repos/:owner/:name/tree', requireAuth, async (req, res) => {
    const { owner, name } = req.params;
    let branch = typeof req.query.branch === 'string' && req.query.branch ? req.query.branch : null;

    try {
        if (!branch) {
            const { data: repoMeta } = await githubApi(`/repos/${owner}/${name}`, req.session.accessToken);
            branch = repoMeta?.default_branch || 'main';
        }
        const { data: branchData } = await githubApi(`/repos/${owner}/${name}/branches/${encodeURIComponent(branch)}`, req.session.accessToken);
        const sha = branchData?.commit?.sha;
        if (!sha) return res.status(404).json({ error: 'Branch SHA not resolvable.' });

        const { data: treeData } = await githubApi(`/repos/${owner}/${name}/git/trees/${sha}?recursive=1`, req.session.accessToken);
        const blobs = Array.isArray(treeData?.tree)
            ? treeData.tree.filter((e) => e?.type === 'blob').map((e) => ({ path: e.path, type: 'blob', size: e.size ?? null }))
            : [];
        const truncated = !!treeData?.truncated || blobs.length > MAX_ENTRIES;
        return res.json({
            branch,
            sha,
            truncated,
            entries: blobs.slice(0, MAX_ENTRIES),
        });
    } catch (e) {
        const status = e?.status || 500;
        if (status === 404) return res.status(404).json({ error: 'Branch or repo not found.' });
        logger.warn({ err: e, owner, name, branch }, 'tree route failed');
        return res.status(500).json({ error: 'Failed to fetch tree.' });
    }
});

export default router;
