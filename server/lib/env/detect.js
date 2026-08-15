// SPDX-License-Identifier: Apache-2.0
// Detects system CLI tools. NEVER throws — returns a status object. The child
// process is reached through an injectable `runner` seam so tests don't spawn.

import { promisify } from 'node:util';
import { execFile as execFileCb } from 'node:child_process';
import { getTool } from './tool-registry.js';
import { parseVersion, satisfiesMin } from './version.js';

const execFile = promisify(execFileCb);

// Default runner: execFile with a hard timeout. windowsHide avoids console pops.
const defaultRunner = async (cmd, args) => {
  const { stdout, stderr } = await execFile(cmd, args, { timeout: 5000, windowsHide: true });
  return { stdout: `${stdout || ''}${stderr || ''}` };
};

// id -> { result, expires }
const cache = new Map();

/** Clear the memoised detection results (test seam + manual refresh). */
export function clearDetectCache() {
  cache.clear();
}

/**
 * Detect a single tool.
 * @param {string|object} idOrEntry
 * @param {{ runner?, platform?, ttlMs?, force? }} [opts]
 * @returns {Promise<object>} DetectResult
 */
export async function detectTool(idOrEntry, opts = {}) {
  const entry = typeof idOrEntry === 'string' ? getTool(idOrEntry) : idOrEntry;
  if (!entry) throw new Error(`Unknown tool: ${idOrEntry}`);

  const platform = opts.platform ?? process.platform;
  const ttlMs = opts.ttlMs ?? 60_000;
  const runner = opts.runner ?? defaultRunner;

  const base = {
    id: entry.id,
    label: entry.label,
    minVersion: entry.minVersion ?? null,
    required: !!entry.required,
  };

  if (!entry.platforms.includes(platform)) {
    return { ...base, status: 'n/a', version: null };
  }

  const cached = cache.get(entry.id);
  if (!opts.force && cached && cached.expires > Date.now()) {
    return { ...cached.result };
  }

  let result;
  try {
    const { stdout } = await runner(entry.detect.cmd, entry.detect.args);
    const version = parseVersion(stdout, entry.detect.versionRegex);
    const status = satisfiesMin(version, entry.minVersion) ? 'ok' : 'outdated';
    result = { ...base, status, version };
  } catch {
    result = { ...base, status: 'missing', version: null };
  }

  cache.set(entry.id, { result, expires: Date.now() + ttlMs });
  return result;
}

/** Detect every tool relevant to the current (or given) platform. */
export async function detectAll(opts = {}) {
  const platform = opts.platform ?? process.platform;
  const { TOOLS } = await import('./tool-registry.js');
  return Promise.all(TOOLS.map((t) => detectTool(t, { ...opts, platform })));
}
