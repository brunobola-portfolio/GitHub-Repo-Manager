// SPDX-License-Identifier: AGPL-3.0-only
// Operator-facing environment tooling status + assisted install (SSE).
import express from 'express';
import { requireAuth, errorResponse, safeError } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/require-admin.js';
import { getReadiness } from '../lib/env/readiness.js';
import { resolveManagers } from '../lib/env/package-managers.js';
import { installTool } from '../lib/env/installer.js';
import { getTool } from '../lib/env/tool-registry.js';
import { config } from '../config.js';
import { auditLog } from '../lib/audit.js';

const router = express.Router();

router.get('/tooling', requireAuth, async (_req, res) => {
  try {
    const readiness = await getReadiness({ force: true });
    const managers = await resolveManagers();
    res.json({ platform: readiness.platform, managers, readiness: { ok: readiness.ok }, tools: readiness.tools });
  } catch (error) {
    errorResponse(res, 500, safeError(error, 'Failed to read tooling status'));
  }
});

router.post('/tooling/:id/install', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  if (!getTool(id)) return errorResponse(res, 404, 'Unknown tool', 'unknown_tool');
  if (config.envToolingInstallEnabled === false) {
    return errorResponse(res, 403, 'Tool installation is disabled on this deployment', 'install_disabled');
  }

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  try {
    const result = await installTool(id, {
      onProgress: send,
      audit: (e) => auditLog(req, e.action, 'env_tool', e.toolId, { manager: e.manager, ok: e.ok, code: e.code }),
    });
    send({ phase: 'result', ...result });
  } catch (error) {
    send({ phase: 'error', message: safeError(error, 'Install failed') });
  } finally {
    res.end();
  }
});

export default router;
