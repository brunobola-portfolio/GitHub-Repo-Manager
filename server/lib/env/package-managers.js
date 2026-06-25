// SPDX-License-Identifier: AGPL-3.0-only
// Resolves the host's native package manager and builds install commands.
// All args are static/allowlisted — no user input is ever interpolated.

import { promisify } from 'node:util';
import { execFile as execFileCb } from 'node:child_process';

const execFile = promisify(execFileCb);

// Probe order = preference order. First available wins.
export const MANAGERS_BY_PLATFORM = {
  win32: ['winget', 'choco', 'scoop'],
  darwin: ['brew'],
  linux: ['apt', 'dnf', 'pacman', 'zypper', 'brew'],
};

// Managers that install system-wide and need root/admin. Surface the command;
// never auto-elevate.
const ELEVATED = new Set(['apt', 'dnf', 'pacman', 'zypper', 'choco']);

const defaultRunner = async (cmd, args) => {
  const { stdout } = await execFile(cmd, args, { timeout: 5000, windowsHide: true });
  return { stdout };
};

// `where` on Windows, `command -v` semantics via `which` elsewhere. We don't
// rely on shell builtins — probe the manager binary directly.
function probeArgs(platform, manager) {
  return platform === 'win32' ? ['/q', manager] : [manager];
}
function probeCmd(platform) {
  return platform === 'win32' ? 'where' : 'which';
}

/** Which package managers are actually installed, in preference order. */
export async function resolveManagers({ platform = process.platform, runner = defaultRunner } = {}) {
  const candidates = MANAGERS_BY_PLATFORM[platform] ?? [];
  const available = [];
  for (const mgr of candidates) {
    try {
      await runner(probeCmd(platform), probeArgs(platform, mgr));
      available.push(mgr);
    } catch {
      // not installed — skip
    }
  }
  return { available, preferred: available[0] ?? null };
}

/** True when installing via `manager` needs root/admin on `platform`. */
export function requiresElevation(manager) {
  return ELEVATED.has(manager);
}

// Per-manager command templates. Package id is the ONLY variable, and it comes
// from the registry (not user input), appended as a discrete argv element.
const TEMPLATES = {
  winget: (id) => ['install', '--exact', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--id', id],
  choco: (id) => ['install', id, '-y'],
  scoop: (id) => ['install', id],
  apt: (id) => ['install', '-y', id],
  dnf: (id) => ['install', '-y', id],
  pacman: (id) => ['-S', '--noconfirm', id],
  zypper: (id) => ['install', '-y', id],
  brew: (id) => ['install', id],
};

/**
 * Build the install command for a registry entry + manager, or null when the
 * entry has no installer for that manager.
 */
export function buildInstallCommand(entry, manager) {
  const installer = entry.installers?.[manager];
  const template = TEMPLATES[manager];
  if (!installer?.id || !template) return null;
  return { cmd: manager, args: template(installer.id) };
}
