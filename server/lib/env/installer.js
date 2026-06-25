// SPDX-License-Identifier: AGPL-3.0-only
// Installs a registry tool via the host's native package manager. Consented by
// the caller (CLI prompt / admin endpoint). Never auto-elevates; never throws.

import { spawn } from 'node:child_process';
import { getTool } from './tool-registry.js';
import { resolveManagers, buildInstallCommand, requiresElevation } from './package-managers.js';
import { detectTool } from './detect.js';
import { sanitizeOutput } from './sanitize.js';

// Default spawn seam: stream stdout/stderr line-by-line, resolve with exit code.
const defaultSpawnRunner = (cmd, args, { onLine } = {}) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let output = '';
    // A spawn error fires both 'error' then 'close'; only the first resolve wins.
    let settled = false;
    const pump = (chunk) => {
      const text = chunk.toString();
      output += text;
      for (const line of text.split(/\r?\n/)) if (line.trim()) onLine?.(sanitizeOutput(line));
    };
    child.stdout?.on('data', pump);
    child.stderr?.on('data', pump);
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      resolve({ code: 1, output: `${output}\n${sanitizeOutput(err.message)}` });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      resolve({ code: code ?? 1, output });
    });
  });

/**
 * @param {string} id - registry tool id
 * @param {object} [opts]
 * @returns {Promise<object>} InstallResult
 */
export async function installTool(id, opts = {}) {
  const {
    platform = process.platform,
    runner,
    spawnRunner = defaultSpawnRunner,
    detectRunner,
    resolveManagersImpl = resolveManagers,
    onProgress,
    audit,
  } = opts;

  const entry = getTool(id);
  if (!entry) return fail(null, 'unknown_tool', `Unknown tool: ${id}`);
  if (!entry.platforms.includes(platform)) return fail(null, 'wrong_platform', `${id} is not used on ${platform}`);

  const { preferred } = await resolveManagersImpl({ platform, runner });
  if (!preferred) return fail(null, 'no_manager', 'No supported package manager found on this host');

  const command = buildInstallCommand(entry, preferred);
  if (!command) {
    return { ...fail(preferred, 'no_installer', entry.notes || `No ${preferred} installer for ${id}`), needsElevation: false };
  }

  const needsElevation = requiresElevation(preferred);
  const printable = sanitizeOutput(`${command.cmd} ${command.args.join(' ')}`);
  onProgress?.({ phase: 'start', manager: preferred, command: printable });

  const { code, output } = await spawnRunner(command.cmd, command.args, {
    onLine: (line) => onProgress?.({ phase: 'line', line: sanitizeOutput(line) }),
  });

  const ok = code === 0;
  let redetected = null;
  if (ok) {
    if (detectRunner) {
      redetected = await detectRunner();
    } else {
      redetected = await detectTool(entry, { platform, force: true });
    }
  }

  audit?.({ action: 'env.tool.install', toolId: id, manager: preferred, ok, code });
  onProgress?.({ phase: 'done', ok, code });

  return {
    ok,
    manager: preferred,
    code,
    needsElevation,
    command: printable,
    output: sanitizeOutput(output).slice(0, 4000),
    redetected,
  };
}

function fail(manager, reason, message) {
  return { ok: false, manager, code: 1, needsElevation: false, command: null, output: sanitizeOutput(message), redetected: null, reason };
}
