// SPDX-License-Identifier: Apache-2.0
// Aggregates detection into a readiness verdict and a preflight assertion.

import { TOOLS } from './tool-registry.js';
import { detectTool } from './detect.js';

/** Typed error thrown by assertReady so migration routes can map it cleanly. */
export class EnvironmentError extends Error {
  constructor({ code, tool, fix, docsUrl, message }) {
    super(message);
    this.name = 'EnvironmentError';
    this.code = code;
    this.tool = tool;
    this.fix = fix;
    this.docsUrl = docsUrl;
  }
}

/** Detect every platform-relevant tool; ok when no REQUIRED tool is missing. */
export async function getReadiness(opts = {}) {
  const platform = opts.platform ?? process.platform;
  const tools = await Promise.all(TOOLS.map((t) => detectTool(t, { ...opts, platform })));
  const ok = tools.every((t) => !(t.required && (t.status === 'missing' || t.status === 'outdated')));
  return { platform, ok, tools };
}

/**
 * Assert the tools needed for the given capabilities are present & current.
 * Throws EnvironmentError on the first unsatisfied tool.
 */
export async function assertReady(capabilities, opts = {}) {
  const platform = opts.platform ?? process.platform;
  const wanted = new Set(capabilities);
  const relevant = TOOLS.filter((t) => t.capabilities.some((c) => wanted.has(c)) && t.platforms.includes(platform));

  for (const entry of relevant) {
    const r = await detectTool(entry, { ...opts, platform });
    if (r.status === 'missing' || r.status === 'outdated') {
      throw new EnvironmentError({
        code: 'ENV_TOOL_MISSING',
        tool: entry.id,
        fix: `Run \`npm run doctor:fix\` or install ${entry.label} on the migration server, then retry.`,
        docsUrl: entry.docsUrl,
        message: `${entry.label} is ${r.status} on the migration server (needed for: ${[...wanted].join(', ')}).`,
      });
    }
  }
}
