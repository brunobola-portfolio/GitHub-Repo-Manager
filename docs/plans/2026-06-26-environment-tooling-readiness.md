# Environment Tooling Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a unified environment-readiness engine that proactively detects and (with consent) installs the system CLI tools the migration engine depends on — git, git-lfs, git-tfs, the TFVC `tf` client — surfaced via a `npm run doctor` CLI, an operator-gated Settings panel, and an early migration preflight.

**Architecture:** One declarative engine under `server/lib/env/` (registry → detect → package-managers → installer → readiness) is the single source of truth. Three thin clients consume it: a CLI doctor script, an Express `/api/env` router, and a migration preflight assertion. The existing lazy checks (`ensureGitLfs`, git-tfs `isAvailable`, `checkGitInstalled`) are refactored to delegate to the engine without changing their public contracts.

**Tech Stack:** Node 22 ESM (`.js`, `type: module`), Express 5, better-sqlite3, Vitest, React 19 + Vite + Tailwind v4, Framer Motion, lucide-react. Child processes via `node:child_process` behind an injectable runner seam.

## Global Constraints

- **Language:** JavaScript only — `.jsx` for React, `.js` for server. NO TypeScript.
- **No new runtime dependencies.** Use Node built-ins (`node:child_process`, `node:util`) only.
- **SQL:** parameterized queries only (none expected in this feature).
- **Styling:** Tailwind utility classes + `ds-*` design-system classes only. NO global CSS selectors.
- **Tests:** unit in `tests/` (frontend) and `server/__tests__/` (backend), mirroring source. NEVER alongside source. Run backend with `npx vitest run server/__tests__/<path>`.
- **Commits:** Conventional Commits `type(scope): description`, subject < 72 chars, NO `Co-Authored-By` lines.
- **Security:** install commands use static/allowlisted args — never interpolate user input into a shell. Never auto-elevate (sudo/admin). Sanitize all captured child-process output before it crosses a trust boundary. Install actions are `requireAdmin`-gated (operator role = `users.is_admin`).
- **Detection never throws** — it returns a status object. Only `assertReady` throws (a typed `EnvironmentError`).

---

## File Structure

**Create (engine):**
- `server/lib/env/tool-registry.js` — declarative catalog + lookups
- `server/lib/env/version.js` — version parse/compare/min-satisfaction
- `server/lib/env/detect.js` — `detectTool` with injectable runner + TTL cache
- `server/lib/env/package-managers.js` — manager resolution + install-command builder
- `server/lib/env/installer.js` — consented install + re-detect + audit
- `server/lib/env/readiness.js` — aggregation + `assertReady` + `EnvironmentError`

**Create (surfaces):**
- `scripts/doctor.mjs` — `npm run doctor` / `doctor:fix`
- `server/routes/env.js` — `GET /api/env/tooling`, `POST /api/env/tooling/:id/install` (SSE)
- `src/components/Settings/EnvironmentToolingSection.jsx` — operator panel

**Modify:**
- `server/import-service.js` — `checkGitInstalled`, `ensureGitLfs` delegate to engine
- `server/lib/git-tfs-runner.js` — `isAvailable` delegates to engine
- `server/index.js` — mount `/api/env`
- `server/routes/migration.js` (or its engine entry) — call `assertReady` in preflight
- `package.json` — add `doctor` / `doctor:fix` scripts
- `src/components/Settings/<settings page>` — render the new section

**Test:**
- `server/__tests__/env/tool-registry.test.js`
- `server/__tests__/env/version.test.js`
- `server/__tests__/env/detect.test.js`
- `server/__tests__/env/package-managers.test.js`
- `server/__tests__/env/installer.test.js`
- `server/__tests__/env/readiness.test.js`
- `server/__tests__/env-routes.test.js`
- `tests/components/Settings/EnvironmentToolingSection.test.jsx`

---

## Task 1: Version utilities

**Files:**
- Create: `server/lib/env/version.js`
- Test: `server/__tests__/env/version.test.js`

**Interfaces:**
- Produces:
  - `parseVersion(output: string, regex: RegExp) => string | null` — first capture group, or null
  - `compareVersions(a: string, b: string) => -1 | 0 | 1`
  - `satisfiesMin(version: string | null, min: string | null) => boolean` — true when no min, or version ≥ min

- [ ] **Step 1: Write the failing test**

```js
// server/__tests__/env/version.test.js
import { describe, it, expect } from 'vitest';
import { parseVersion, compareVersions, satisfiesMin } from '../../lib/env/version.js';

describe('parseVersion', () => {
  it('extracts a semver from typical CLI output', () => {
    expect(parseVersion('git version 2.45.1.windows.1', /git version (\d+\.\d+\.\d+)/)).toBe('2.45.1');
    expect(parseVersion('git-lfs/3.5.1 (GitHub; ...)', /git-lfs\/(\d+\.\d+\.\d+)/)).toBe('3.5.1');
  });
  it('returns null when no match', () => {
    expect(parseVersion('nonsense', /v(\d+\.\d+\.\d+)/)).toBeNull();
  });
});

describe('compareVersions', () => {
  it('orders versions numerically, not lexically', () => {
    expect(compareVersions('2.10.0', '2.9.0')).toBe(1);
    expect(compareVersions('2.9.0', '2.10.0')).toBe(-1);
    expect(compareVersions('3.5.1', '3.5.1')).toBe(0);
  });
  it('treats missing segments as zero', () => {
    expect(compareVersions('3', '3.0.0')).toBe(0);
  });
});

describe('satisfiesMin', () => {
  it('is true when no minimum is required', () => {
    expect(satisfiesMin('1.0.0', null)).toBe(true);
  });
  it('compares against the minimum', () => {
    expect(satisfiesMin('3.5.1', '2.0.0')).toBe(true);
    expect(satisfiesMin('1.9.9', '2.0.0')).toBe(false);
  });
  it('is false when version is unknown but a min is required', () => {
    expect(satisfiesMin(null, '2.0.0')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/env/version.test.js`
Expected: FAIL — "Failed to resolve import '../../lib/env/version.js'"

- [ ] **Step 3: Write minimal implementation**

```js
// server/lib/env/version.js
// SPDX-License-Identifier: AGPL-3.0-only
// Pure semver-ish helpers for tool detection. No I/O.

/** Extract the first capture group of `regex` from `output`, or null. */
export function parseVersion(output, regex) {
  const m = String(output).match(regex);
  return m && m[1] ? m[1] : null;
}

/** Numeric, segment-wise compare. Missing segments count as 0. */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/** True when no min is required, or `version` is present and >= `min`. */
export function satisfiesMin(version, min) {
  if (!min) return true;
  if (!version) return false;
  return compareVersions(version, min) >= 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/env/version.test.js`
Expected: PASS (3 suites)

- [ ] **Step 5: Commit**

```bash
git add server/lib/env/version.js server/__tests__/env/version.test.js
git commit -m "feat(env): version parse/compare helpers"
```

---

## Task 2: Tool registry

**Files:**
- Create: `server/lib/env/tool-registry.js`
- Test: `server/__tests__/env/tool-registry.test.js`

**Interfaces:**
- Produces:
  - `TOOLS: ToolEntry[]` — the declarative catalog
  - `getTool(id: string) => ToolEntry | undefined`
  - `toolsForPlatform(platform: string) => ToolEntry[]`
  - `ToolEntry` shape: `{ id, label, docsUrl, platforms: string[], detect: { cmd, args, versionRegex }, minVersion: string|null, capabilities: string[], required: boolean, installers: Record<manager,{id}|{command}>, postInstall?: string[], notes?: string|null }`

- [ ] **Step 1: Write the failing test**

```js
// server/__tests__/env/tool-registry.test.js
import { describe, it, expect } from 'vitest';
import { TOOLS, getTool, toolsForPlatform } from '../../lib/env/tool-registry.js';

describe('tool registry', () => {
  it('includes the migration-critical tools', () => {
    const ids = TOOLS.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(['git', 'git-lfs', 'git-tfs', 'tf']));
  });

  it('every entry has a detect spec and is installable or has guidance notes', () => {
    for (const t of TOOLS) {
      expect(t.detect?.cmd, `${t.id} detect.cmd`).toBeTruthy();
      expect(Array.isArray(t.detect.args), `${t.id} detect.args`).toBe(true);
      expect(t.detect.versionRegex instanceof RegExp, `${t.id} versionRegex`).toBe(true);
      const installable = t.installers && Object.keys(t.installers).length > 0;
      expect(installable || !!t.notes, `${t.id} installable-or-notes`).toBe(true);
    }
  });

  it('git-tfs is win32-only', () => {
    expect(getTool('git-tfs').platforms).toEqual(['win32']);
  });

  it('toolsForPlatform filters by platform', () => {
    const linux = toolsForPlatform('linux').map((t) => t.id);
    expect(linux).not.toContain('git-tfs');
    expect(linux).toContain('git');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/env/tool-registry.test.js`
Expected: FAIL — cannot resolve `tool-registry.js`

- [ ] **Step 3: Write minimal implementation**

```js
// server/lib/env/tool-registry.js
// SPDX-License-Identifier: AGPL-3.0-only
// Declarative catalog of the system CLI tools the migration engine needs.
// Pure data + lookups — no I/O. This is the single source of truth that
// detect/installer/readiness and every surface (doctor CLI, /api/env, UI) read.

const ALL = ['win32', 'darwin', 'linux'];

/** @type {Array<object>} */
export const TOOLS = [
  {
    id: 'git',
    label: 'Git',
    docsUrl: 'https://git-scm.com/downloads',
    platforms: ALL,
    detect: { cmd: 'git', args: ['--version'], versionRegex: /git version (\d+\.\d+\.\d+)/ },
    minVersion: '2.20.0',
    capabilities: ['git-import', 'lfs', 'lfs-migrate', 'tfvc'],
    required: true,
    installers: {
      winget: { id: 'Git.Git' },
      choco: { id: 'git' },
      scoop: { id: 'git' },
      apt: { id: 'git' },
      dnf: { id: 'git' },
      pacman: { id: 'git' },
      zypper: { id: 'git' },
      brew: { id: 'git' },
    },
    notes: null,
  },
  {
    id: 'git-lfs',
    label: 'Git LFS',
    docsUrl: 'https://git-lfs.com',
    platforms: ALL,
    detect: { cmd: 'git', args: ['lfs', 'version'], versionRegex: /git-lfs\/(\d+\.\d+\.\d+)/ },
    minVersion: '2.0.0',
    capabilities: ['lfs', 'lfs-migrate'],
    required: false,
    installers: {
      winget: { id: 'GitHub.GitLFS' },
      choco: { id: 'git-lfs' },
      scoop: { id: 'git-lfs' },
      apt: { id: 'git-lfs' },
      dnf: { id: 'git-lfs' },
      pacman: { id: 'git-lfs' },
      zypper: { id: 'git-lfs' },
      brew: { id: 'git-lfs' },
    },
    postInstall: ['lfs', 'install'],
    notes: null,
  },
  {
    id: 'git-tfs',
    label: 'git-tfs (TFVC → Git)',
    docsUrl: 'https://github.com/git-tfs/git-tfs',
    platforms: ['win32'],
    detect: { cmd: 'git-tfs', args: ['--version'], versionRegex: /git-tfs version (\d+\.\d+\.\d+)/ },
    minVersion: null,
    capabilities: ['tfvc-clone'],
    required: false,
    installers: {
      choco: { id: 'gittfs' },
      scoop: { id: 'git-tfs' },
    },
    // git-tfs also needs VS Build Tools + TFS Client OM, which is NOT scriptable here.
    notes:
      'git-tfs additionally requires Visual Studio Build Tools 2017+ with the TFS Client Object Model. Install those manually if TFVC clones fail after git-tfs is present.',
  },
  {
    id: 'tf',
    label: 'TFVC client (tf)',
    docsUrl: 'https://learn.microsoft.com/azure/devops/repos/tfvc/',
    platforms: ALL,
    detect: { cmd: 'tf', args: ['vc', 'help'], versionRegex: /Version (\d+\.\d+\.\d+)/ },
    minVersion: null,
    capabilities: ['tfvc'],
    required: false,
    installers: {},
    notes:
      'The TFVC command-line client ships with Visual Studio / Team Explorer Everywhere and is not installable via a package manager. Install Visual Studio or TEE and ensure `tf` is on PATH.',
  },
];

/** Find a tool by id. */
export function getTool(id) {
  return TOOLS.find((t) => t.id === id);
}

/** Tools relevant to a given platform (`process.platform` value). */
export function toolsForPlatform(platform) {
  return TOOLS.filter((t) => t.platforms.includes(platform));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/env/tool-registry.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/lib/env/tool-registry.js server/__tests__/env/tool-registry.test.js
git commit -m "feat(env): declarative tool registry"
```

---

## Task 3: Tool detection

**Files:**
- Create: `server/lib/env/detect.js`
- Test: `server/__tests__/env/detect.test.js`

**Interfaces:**
- Consumes: `getTool`, `toolsForPlatform` (Task 2); `parseVersion`, `satisfiesMin` (Task 1)
- Produces:
  - `detectTool(idOrEntry, opts?) => Promise<DetectResult>` where `opts = { runner?, platform?, ttlMs?, force? }`
  - `detectAll(opts?) => Promise<DetectResult[]>`
  - `clearDetectCache() => void`
  - `DetectResult = { id, label, status: 'ok'|'outdated'|'missing'|'n/a', version: string|null, minVersion: string|null, required: boolean }`
  - The `runner` seam: `(cmd: string, args: string[]) => Promise<{ stdout: string }>`; default uses `execFile` with a 5s timeout. A throw (ENOENT / non-zero exit) means "not found".

- [ ] **Step 1: Write the failing test**

```js
// server/__tests__/env/detect.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { detectTool, clearDetectCache } from '../../lib/env/detect.js';

beforeEach(() => clearDetectCache());

const okGit = (out) => vi.fn().mockResolvedValue({ stdout: out });
const missing = () => vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

describe('detectTool', () => {
  it('reports ok with parsed version when the tool responds', async () => {
    const r = await detectTool('git', { runner: okGit('git version 2.45.1'), platform: 'linux' });
    expect(r).toMatchObject({ id: 'git', status: 'ok', version: '2.45.1' });
  });

  it('reports outdated when below minVersion', async () => {
    const r = await detectTool('git', { runner: okGit('git version 2.10.0'), platform: 'linux' });
    expect(r.status).toBe('outdated');
  });

  it('reports missing when the runner throws', async () => {
    const r = await detectTool('git-lfs', { runner: missing(), platform: 'linux' });
    expect(r).toMatchObject({ id: 'git-lfs', status: 'missing', version: null });
  });

  it('reports n/a for a tool not relevant on this platform', async () => {
    const r = await detectTool('git-tfs', { runner: okGit('whatever'), platform: 'linux' });
    expect(r.status).toBe('n/a');
  });

  it('caches within TTL — runner called once for two reads', async () => {
    const runner = okGit('git version 2.45.1');
    await detectTool('git', { runner, platform: 'linux', ttlMs: 10_000 });
    await detectTool('git', { runner, platform: 'linux', ttlMs: 10_000 });
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('force bypasses the cache', async () => {
    const runner = okGit('git version 2.45.1');
    await detectTool('git', { runner, platform: 'linux' });
    await detectTool('git', { runner, platform: 'linux', force: true });
    expect(runner).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/env/detect.test.js`
Expected: FAIL — cannot resolve `detect.js`

- [ ] **Step 3: Write minimal implementation**

```js
// server/lib/env/detect.js
// SPDX-License-Identifier: AGPL-3.0-only
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
    return cached.result;
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/env/detect.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add server/lib/env/detect.js server/__tests__/env/detect.test.js
git commit -m "feat(env): tool detection with injectable runner + TTL cache"
```

---

## Task 4: Package-manager resolution & install-command builder

**Files:**
- Create: `server/lib/env/package-managers.js`
- Test: `server/__tests__/env/package-managers.test.js`

**Interfaces:**
- Consumes: nothing from prior tasks (uses a `runner` seam shaped like Task 3's)
- Produces:
  - `MANAGERS_BY_PLATFORM: Record<platform, string[]>`
  - `resolveManagers({ platform, runner }) => Promise<{ available: string[], preferred: string|null }>`
  - `requiresElevation(manager: string, platform: string) => boolean`
  - `buildInstallCommand(entry, manager) => { cmd: string, args: string[] } | null` — null when the entry has no installer for that manager

- [ ] **Step 1: Write the failing test**

```js
// server/__tests__/env/package-managers.test.js
import { describe, it, expect, vi } from 'vitest';
import {
  resolveManagers,
  requiresElevation,
  buildInstallCommand,
} from '../../lib/env/package-managers.js';
import { getTool } from '../../lib/env/tool-registry.js';

// runner that "finds" only the managers in `present`
const runnerWith = (present) =>
  vi.fn(async (cmd, args) => {
    const probed = args[args.length - 1];
    if (present.includes(probed)) return { stdout: `/usr/bin/${probed}` };
    throw new Error('not found');
  });

describe('resolveManagers', () => {
  it('picks winget as preferred on win32 when present', async () => {
    const { available, preferred } = await resolveManagers({
      platform: 'win32',
      runner: runnerWith(['winget', 'choco']),
    });
    expect(available).toContain('winget');
    expect(preferred).toBe('winget');
  });

  it('returns no preferred when nothing is installed', async () => {
    const { available, preferred } = await resolveManagers({
      platform: 'linux',
      runner: runnerWith([]),
    });
    expect(available).toEqual([]);
    expect(preferred).toBeNull();
  });
});

describe('buildInstallCommand', () => {
  it('builds a winget command for git-lfs with static args', () => {
    const cmd = buildInstallCommand(getTool('git-lfs'), 'winget');
    expect(cmd).toEqual({
      cmd: 'winget',
      args: ['install', '--exact', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--id', 'GitHub.GitLFS'],
    });
  });

  it('returns null when the tool has no installer for the manager', () => {
    expect(buildInstallCommand(getTool('tf'), 'apt')).toBeNull();
  });
});

describe('requiresElevation', () => {
  it('flags apt/dnf as needing elevation', () => {
    expect(requiresElevation('apt', 'linux')).toBe(true);
    expect(requiresElevation('brew', 'darwin')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/env/package-managers.test.js`
Expected: FAIL — cannot resolve `package-managers.js`

- [ ] **Step 3: Write minimal implementation**

```js
// server/lib/env/package-managers.js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/env/package-managers.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/lib/env/package-managers.js server/__tests__/env/package-managers.test.js
git commit -m "feat(env): package-manager resolution and install-command builder"
```

---

## Task 5: Installer

**Files:**
- Create: `server/lib/env/installer.js`
- Test: `server/__tests__/env/installer.test.js`

**Interfaces:**
- Consumes: `getTool` (Task 2), `resolveManagers`, `buildInstallCommand`, `requiresElevation` (Task 4), `detectTool` (Task 3)
- Produces:
  - `installTool(id, opts?) => Promise<InstallResult>` where `opts = { platform?, runner?, detectRunner?, spawnRunner?, onProgress?, audit? }`
  - `InstallResult = { ok: boolean, manager: string|null, code: number, needsElevation: boolean, command: string|null, output: string, redetected: object|null, reason?: string }`
  - `spawnRunner` seam: `(cmd, args, { onLine }) => Promise<{ code: number, output: string }>`; default streams a real `spawn`.
  - Refuses unknown ids (`ok:false, reason:'unknown_tool'`) and tools with no installer for the host (`reason:'no_installer'`).

- [ ] **Step 1: Write the failing test**

```js
// server/__tests__/env/installer.test.js
import { describe, it, expect, vi } from 'vitest';
import { installTool } from '../../lib/env/installer.js';

const winget = { available: ['winget'], preferred: 'winget' };
const okDetect = vi.fn().mockResolvedValue({ id: 'git-lfs', status: 'ok', version: '3.5.1' });

function deps({ code = 0 } = {}) {
  return {
    platform: 'win32',
    resolveManagersImpl: vi.fn().mockResolvedValue(winget),
    spawnRunner: vi.fn(async (cmd, args, { onLine }) => {
      onLine?.('downloading...');
      return { code, output: 'Successfully installed' };
    }),
    detectRunner: () => okDetect(),
  };
}

describe('installTool', () => {
  it('refuses an unknown tool', async () => {
    const r = await installTool('not-a-tool', deps());
    expect(r).toMatchObject({ ok: false, reason: 'unknown_tool' });
  });

  it('installs via the preferred manager and re-detects on success', async () => {
    const d = deps();
    const r = await installTool('git-lfs', d);
    expect(d.spawnRunner).toHaveBeenCalledWith(
      'winget',
      expect.arrayContaining(['install', '--id', 'GitHub.GitLFS']),
      expect.any(Object),
    );
    expect(r).toMatchObject({ ok: true, manager: 'winget', code: 0 });
    expect(r.redetected).toMatchObject({ status: 'ok' });
  });

  it('reports a failed install without throwing', async () => {
    const r = await installTool('git-lfs', deps({ code: 1 }));
    expect(r).toMatchObject({ ok: false, code: 1 });
  });

  it('reports no_installer when the host has no manager for the tool', async () => {
    const d = deps();
    d.resolveManagersImpl = vi.fn().mockResolvedValue({ available: ['apt'], preferred: 'apt' });
    d.platform = 'linux';
    const r = await installTool('tf', d); // tf has no installers
    expect(r).toMatchObject({ ok: false, reason: 'no_installer' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/env/installer.test.js`
Expected: FAIL — cannot resolve `installer.js`

- [ ] **Step 3: Write minimal implementation**

```js
// server/lib/env/installer.js
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
    const pump = (chunk) => {
      const text = chunk.toString();
      output += text;
      for (const line of text.split(/\r?\n/)) if (line.trim()) onLine?.(line);
    };
    child.stdout?.on('data', pump);
    child.stderr?.on('data', pump);
    child.on('error', (err) => resolve({ code: 1, output: `${output}\n${err.message}` }));
    child.on('close', (code) => resolve({ code: code ?? 1, output }));
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
  const printable = `${command.cmd} ${command.args.join(' ')}`;
  onProgress?.({ phase: 'start', manager: preferred, command: printable });

  const { code, output } = await spawnRunner(command.cmd, command.args, {
    onLine: (line) => onProgress?.({ phase: 'line', line: sanitizeOutput(line) }),
  });

  const ok = code === 0;
  let redetected = null;
  if (ok) {
    redetected = await detectTool(entry, { platform, runner: detectRunner, force: true });
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
  return { ok: false, manager, code: 1, needsElevation: false, command: null, output: message, redetected: null, reason };
}
```

Also create the shared sanitizer (extracted from `git-tfs-runner.js`'s pattern so both can use it):

```js
// server/lib/env/sanitize.js
// SPDX-License-Identifier: AGPL-3.0-only
// Scrub anything credential-shaped from captured child-process output before it
// crosses a trust boundary (API/SSE/logs). Mirrors git-tfs-runner.sanitizeStderr.

export function sanitizeOutput(raw) {
  if (!raw) return '';
  let out = String(raw);
  out = out.replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1***@');
  out = out.replace(/(authorization\s*:\s*)(bearer|basic)\s+\S+/gi, '$1$2 ***');
  out = out.replace(/\b[A-Za-z0-9_\-+/=]{32,}\b/g, '***');
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/env/installer.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/lib/env/installer.js server/lib/env/sanitize.js server/__tests__/env/installer.test.js
git commit -m "feat(env): consented native-manager installer with output sanitizer"
```

---

## Task 6: Readiness aggregation & preflight

**Files:**
- Create: `server/lib/env/readiness.js`
- Test: `server/__tests__/env/readiness.test.js`

**Interfaces:**
- Consumes: `TOOLS` (Task 2), `detectTool` (Task 3)
- Produces:
  - `class EnvironmentError extends Error` with `{ code, tool, fix, docsUrl }`
  - `getReadiness(opts?) => Promise<{ platform, ok, tools: DetectResult[] }>` — `ok` is true when no *required* tool is missing
  - `assertReady(capabilities: string[], opts?) => Promise<void>` — throws `EnvironmentError` when a tool whose `capabilities` intersect the requested set is `missing`/`outdated`

- [ ] **Step 1: Write the failing test**

```js
// server/__tests__/env/readiness.test.js
import { describe, it, expect, vi } from 'vitest';
import { getReadiness, assertReady, EnvironmentError } from '../../lib/env/readiness.js';

// runner that makes git ok but git-lfs missing
const runner = vi.fn(async (cmd, args) => {
  if (args[0] === 'lfs') throw new Error('ENOENT');
  return { stdout: 'git version 2.45.1' };
});

describe('getReadiness', () => {
  it('is ok when required tools are present (lfs is optional)', async () => {
    const r = await getReadiness({ runner, platform: 'linux', force: true });
    expect(r.ok).toBe(true);
    expect(r.tools.find((t) => t.id === 'git-lfs').status).toBe('missing');
  });
});

describe('assertReady', () => {
  it('throws EnvironmentError naming the missing tool for the capability', async () => {
    await expect(assertReady(['lfs'], { runner, platform: 'linux', force: true }))
      .rejects.toMatchObject({ code: 'ENV_TOOL_MISSING', tool: 'git-lfs' });
  });

  it('resolves when the capability is satisfied', async () => {
    await expect(assertReady(['git-import'], { runner, platform: 'linux', force: true }))
      .resolves.toBeUndefined();
  });

  it('exposes EnvironmentError as a typed error', async () => {
    const err = await assertReady(['lfs'], { runner, platform: 'linux', force: true }).catch((e) => e);
    expect(err).toBeInstanceOf(EnvironmentError);
    expect(err.docsUrl).toContain('git-lfs');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/env/readiness.test.js`
Expected: FAIL — cannot resolve `readiness.js`

- [ ] **Step 3: Write minimal implementation**

```js
// server/lib/env/readiness.js
// SPDX-License-Identifier: AGPL-3.0-only
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/env/readiness.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/lib/env/readiness.js server/__tests__/env/readiness.test.js
git commit -m "feat(env): readiness aggregation and assertReady preflight"
```

---

## Task 7: Delegate the existing lazy checks to the engine

**Files:**
- Modify: `server/import-service.js:39-47` (`checkGitInstalled`) and `:163-173` (`ensureGitLfs`)
- Modify: `server/lib/git-tfs-runner.js:28-41` (`isAvailable`)
- Test: existing `server/__tests__/import-service-lfs.test.js`, `server/__tests__/import-service-core.test.js`, `server/__tests__/tfvc-cascade.test.js` must stay green

**Interfaces:**
- Consumes: `detectTool` (Task 3), `EnvironmentError`/`assertReady` (Task 6)
- Produces: unchanged public behaviour — `checkGitInstalled()` still returns `{ installed, version }`; `ensureGitLfs(runRaw)` still throws an error with `.code === 'GIT_LFS_MISSING'`; git-tfs `isAvailable()` still returns a boolean.

- [ ] **Step 1: Run the existing tests to capture the green baseline**

Run: `npx vitest run server/__tests__/import-service-lfs.test.js server/__tests__/import-service-core.test.js server/__tests__/tfvc-cascade.test.js`
Expected: PASS (record the count)

- [ ] **Step 2: Rewrite `checkGitInstalled` to delegate**

In `server/import-service.js`, replace the body of `checkGitInstalled` (keep the name/return shape):

```js
import { detectTool } from './lib/env/detect.js';

async function checkGitInstalled() {
  const r = await detectTool('git');
  return { installed: r.status === 'ok' || r.status === 'outdated', version: r.version };
}
```

- [ ] **Step 3: Keep `ensureGitLfs` contract, source the check from the engine**

`ensureGitLfs(runRaw)` is called with the repo's git runner. Preserve its throw contract; only the *detection* moves. Replace its body:

```js
import { detectTool } from './lib/env/detect.js';

export async function ensureGitLfs(runRaw) {
  // The repo-scoped runRaw stays the detection path (honours the repo's PATH),
  // but normalise the "missing" verdict through the engine's status model.
  const probe = await detectTool('git-lfs', {
    runner: async (_cmd, args) => ({ stdout: await runRaw(args) }),
    force: true,
  });
  if (probe.status === 'missing') {
    const err = new Error(
      "Git LFS is not installed on the migration server, so files over GitHub's 100 MB limit cannot be converted. Install git-lfs (https://git-lfs.com) on the server and retry, or choose \"Exclude\" for this repository.",
    );
    err.code = 'GIT_LFS_MISSING';
    throw err;
  }
}
```

- [ ] **Step 4: Delegate git-tfs `isAvailable`**

In `server/lib/git-tfs-runner.js`, replace the `isAvailable` body (keep memoisation + boolean return):

```js
import { detectTool } from './env/detect.js';

export async function isAvailable() {
  if (cachedAvailability !== null) return cachedAvailability;
  const r = await detectTool('git-tfs');
  cachedAvailability = r.status === 'ok';
  return cachedAvailability;
}
```

- [ ] **Step 5: Run the baseline tests again**

Run: `npx vitest run server/__tests__/import-service-lfs.test.js server/__tests__/import-service-core.test.js server/__tests__/tfvc-cascade.test.js`
Expected: PASS — same count as Step 1.

- [ ] **Step 6: Commit**

```bash
git add server/import-service.js server/lib/git-tfs-runner.js
git commit -m "refactor(env): delegate git/lfs/git-tfs checks to readiness engine"
```

---

## Task 8: `npm run doctor` CLI

**Files:**
- Create: `scripts/doctor.mjs`
- Modify: `package.json` (`scripts`)
- Test: `server/__tests__/env/doctor-format.test.js` (pure formatting only)

**Interfaces:**
- Consumes: `getReadiness` (Task 6), `resolveManagers`/`buildInstallCommand` (Task 4), `installTool` (Task 5)
- Produces: `formatToolLine(tool, { managers }) => string` (exported pure helper, testable); the script's side effects (printing, installing) are not unit-tested.

- [ ] **Step 1: Write the failing test (pure formatter)**

```js
// server/__tests__/env/doctor-format.test.js
import { describe, it, expect } from 'vitest';
import { formatToolLine } from '../../../scripts/doctor.mjs';

describe('formatToolLine', () => {
  it('renders an ok tool with its version', () => {
    const line = formatToolLine({ id: 'git', label: 'Git', status: 'ok', version: '2.45.1' }, {});
    expect(line).toContain('Git');
    expect(line).toContain('2.45.1');
    expect(line).toMatch(/ok|✓/i);
  });
  it('renders a missing tool', () => {
    const line = formatToolLine({ id: 'git-lfs', label: 'Git LFS', status: 'missing', version: null }, {});
    expect(line).toMatch(/missing|✗/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/env/doctor-format.test.js`
Expected: FAIL — cannot resolve `scripts/doctor.mjs`

- [ ] **Step 3: Write the script**

```js
// scripts/doctor.mjs
// SPDX-License-Identifier: AGPL-3.0-only
// `npm run doctor` — validate migration tooling; `--fix` installs what's missing.
import process from 'node:process';
import { createInterface } from 'node:readline';
import { getReadiness } from '../server/lib/env/readiness.js';
import { resolveManagers, buildInstallCommand } from '../server/lib/env/package-managers.js';
import { installTool } from '../server/lib/env/installer.js';
import { getTool } from '../server/lib/env/tool-registry.js';

const ICON = { ok: '✓', outdated: '!', missing: '✗', 'n/a': '·' };

export function formatToolLine(tool) {
  const icon = ICON[tool.status] ?? '?';
  const ver = tool.version ? ` ${tool.version}` : '';
  const tag = tool.status === 'ok' ? '' : `  [${tool.status}]`;
  return `  ${icon} ${tool.label}${ver}${tag}`;
}

async function main() {
  const fix = process.argv.includes('--fix');
  const yes = process.argv.includes('--yes');
  const { tools, ok } = await getReadiness({ force: true });
  const { preferred, available } = await resolveManagers();

  process.stdout.write('\nMigration tooling readiness\n\n');
  for (const t of tools) process.stdout.write(formatToolLine(t) + '\n');
  process.stdout.write(`\nPackage managers: ${available.join(', ') || 'none detected'}\n`);

  const fixable = tools.filter((t) => (t.status === 'missing' || t.status === 'outdated') && buildInstallCommand(getTool(t.id), preferred));
  if (fixable.length && !fix) {
    process.stdout.write('\nTo install the missing tools, run:  npm run doctor:fix\n');
    for (const t of fixable) {
      const c = buildInstallCommand(getTool(t.id), preferred);
      process.stdout.write(`  ${t.label}:  ${c.cmd} ${c.args.join(' ')}\n`);
    }
  }

  if (fix && fixable.length) {
    for (const t of fixable) {
      if (!yes && !(await confirm(`Install ${t.label} via ${preferred}?`))) continue;
      process.stdout.write(`\nInstalling ${t.label}…\n`);
      const r = await installTool(t.id, { onProgress: (e) => e.line && process.stdout.write(`  ${e.line}\n`) });
      process.stdout.write(r.ok ? `  ✓ ${t.label} installed\n` : `  ✗ ${t.label} failed (exit ${r.code})\n`);
    }
  }

  // Required-missing → non-zero exit for CI.
  process.exit(ok ? 0 : 1);
}

function confirm(q) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(`${q} [y/N] `, (a) => { rl.close(); res(/^y/i.test(a)); }));
}

// Only run when invoked directly (not when imported by the formatter test).
if (process.argv[1] && process.argv[1].endsWith('doctor.mjs')) {
  main().catch((e) => { process.stderr.write(String(e?.stack || e) + '\n'); process.exit(1); });
}
```

- [ ] **Step 4: Add scripts to package.json**

In `package.json` `scripts`, add:

```json
"doctor": "node scripts/doctor.mjs",
"doctor:fix": "node scripts/doctor.mjs --fix",
```

- [ ] **Step 5: Run the formatter test + a smoke run**

Run: `npx vitest run server/__tests__/env/doctor-format.test.js`
Expected: PASS

Run: `npm run doctor`
Expected: prints a readiness table; exits 0 if git is present.

- [ ] **Step 6: Commit**

```bash
git add scripts/doctor.mjs package.json server/__tests__/env/doctor-format.test.js
git commit -m "feat(env): npm run doctor CLI for tooling readiness"
```

---

## Task 9: `/api/env` routes

**Files:**
- Create: `server/routes/env.js`
- Modify: `server/index.js` (mount after the health router, ~line 182)
- Test: `server/__tests__/env-routes.test.js`

**Interfaces:**
- Consumes: `getReadiness` (Task 6), `installTool` (Task 5), `resolveManagers` (Task 4); `requireAuth`/`requireAdmin` middleware; `config`
- Produces:
  - `GET /api/env/tooling` (auth) → `{ platform, managers, readiness: { ok }, tools }`
  - `POST /api/env/tooling/:id/install` (auth + admin) → SSE stream of `{ phase, ... }` events; disabled (403 `install_disabled`) when `config.envToolingInstallEnabled === false`
  - Default export: the Express router

- [ ] **Step 1: Write the failing test**

```js
// server/__tests__/env-routes.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../lib/env/readiness.js', () => ({
  getReadiness: vi.fn().mockResolvedValue({ platform: 'linux', ok: true, tools: [{ id: 'git', status: 'ok', version: '2.45.1' }] }),
}));
vi.mock('../lib/env/package-managers.js', () => ({ resolveManagers: vi.fn().mockResolvedValue({ available: ['apt'], preferred: 'apt' }) }));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => next(),
  errorResponse: (res, code, msg, c) => res.status(code).json({ error: msg, code: c }),
  safeError: (e, f) => f,
}));
vi.mock('../middleware/require-admin.js', () => ({ requireAdmin: (req, res, next) => (req.headers['x-admin'] ? next() : res.status(403).json({ error: 'Admin only' })) }));

let router;
beforeEach(async () => { router = (await import('../routes/env.js')).default; });

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/env', router);
  return a;
}

describe('GET /api/env/tooling', () => {
  it('returns readiness + managers', async () => {
    const res = await request(app()).get('/api/env/tooling');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ platform: 'linux', readiness: { ok: true } });
    expect(res.body.managers.preferred).toBe('apt');
  });
});

describe('POST /api/env/tooling/:id/install', () => {
  it('is admin-gated', async () => {
    const res = await request(app()).post('/api/env/tooling/git-lfs/install');
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/env-routes.test.js`
Expected: FAIL — cannot resolve `routes/env.js`

- [ ] **Step 3: Write the router**

```js
// server/routes/env.js
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
import { logAudit } from '../lib/audit.js';

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
      audit: (entry) => logAudit({ ...entry, userId: req.session.userId }),
    });
    send({ phase: 'result', ...result });
  } catch (error) {
    send({ phase: 'error', message: safeError(error, 'Install failed') });
  } finally {
    res.end();
  }
});

export default router;
```

Add the config flag in `server/config.js` (default enabled; operators disable in hosted SaaS):

```js
envToolingInstallEnabled: process.env.ENV_TOOLING_INSTALL_ENABLED !== 'false',
```

> If `logAudit` is not the exact export name in `server/lib/audit.js`, check that file and use its real logging function; the audit call is best-effort and must not break the request.

- [ ] **Step 4: Mount the router**

In `server/index.js`, after the health router mount (`app.use('/api/health', healthRouter);`, ~line 182):

```js
import envRouter from './routes/env.js';
app.use('/api/env', envRouter);
```

- [ ] **Step 5: Run the route test**

Run: `npx vitest run server/__tests__/env-routes.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/routes/env.js server/index.js server/config.js server/__tests__/env-routes.test.js
git commit -m "feat(env): /api/env tooling status + admin-gated install (SSE)"
```

---

## Task 10: Migration preflight integration

**Files:**
- Modify: `server/routes/migration.js` — call `assertReady` before a job runs, map `EnvironmentError`
- Test: `server/__tests__/migration-preflight.test.js`

**Interfaces:**
- Consumes: `assertReady`, `EnvironmentError` (Task 6)
- Produces: a `preflightTooling(job) => Promise<void>` helper (exported for the test) that maps a job's source type to capabilities and calls `assertReady`. On failure it rethrows the `EnvironmentError` so the engine marks the job failed with `errorMessage = err.message` and `code = err.code`.

> Capability mapping (from the registry): `azure-tfvc` job → `['tfvc', 'tfvc-clone']`; any job with LFS or `sizeStrategy === 'lfs-migrate'` → add `['lfs', 'lfs-migrate']`; all git imports → `['git-import']`.

- [ ] **Step 1: Write the failing test**

```js
// server/__tests__/migration-preflight.test.js
import { describe, it, expect, vi } from 'vitest';
import { preflightTooling } from '../routes/migration.js';

const missingLfs = vi.fn(async (cmd, args) => {
  if (args[0] === 'lfs') throw new Error('ENOENT');
  return { stdout: 'git version 2.45.1' };
});

describe('preflightTooling', () => {
  it('throws ENV_TOOL_MISSING when an LFS job lacks git-lfs', async () => {
    const job = { sourceType: 'github', sizeStrategy: 'lfs-migrate' };
    await expect(preflightTooling(job, { runner: missingLfs, platform: 'linux', force: true }))
      .rejects.toMatchObject({ code: 'ENV_TOOL_MISSING', tool: 'git-lfs' });
  });

  it('passes when only git is needed and git is present', async () => {
    const job = { sourceType: 'github' };
    await expect(preflightTooling(job, { runner: missingLfs, platform: 'linux', force: true }))
      .resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/migration-preflight.test.js`
Expected: FAIL — `preflightTooling` is not exported

- [ ] **Step 3: Add the preflight helper and wire it in**

In `server/routes/migration.js`, add and export:

```js
import { assertReady } from '../lib/env/readiness.js';

export async function preflightTooling(job, opts = {}) {
  const caps = ['git-import'];
  if (job.sourceType === 'azure-tfvc') caps.push('tfvc', 'tfvc-clone');
  if (job.hasLFS || job.sizeStrategy === 'lfs-migrate') caps.push('lfs', 'lfs-migrate');
  await assertReady(caps, opts);
}
```

Then call it at the start of the job runner, before any clone work begins (locate where the engine transitions a job to `running` and invoke `await preflightTooling(job)` there; let the existing failure path catch the thrown `EnvironmentError` and persist `errorMessage`/`code`).

- [ ] **Step 4: Run the preflight test**

Run: `npx vitest run server/__tests__/migration-preflight.test.js`
Expected: PASS

- [ ] **Step 5: Run the migration suite to confirm no regression**

Run: `npx vitest run server/__tests__/migration-engine.test.js server/__tests__/migration-routes-shape.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/routes/migration.js server/__tests__/migration-preflight.test.js
git commit -m "feat(env): preflight migration tooling before a job runs"
```

---

## Task 11: Settings UI section

**Files:**
- Create: `src/components/Settings/EnvironmentToolingSection.jsx`
- Modify: the Settings page that renders sections (find via `grep -r "ProbeStatsSection" src/`) — add a tab/section entry
- Test: `tests/components/Settings/EnvironmentToolingSection.test.jsx`

**Interfaces:**
- Consumes: `apiCall` (`src/utils/api.js`), `useTabData` (`src/hooks/useTabData.js`), `useToast`, UI primitives `Card`/`Button`/`PanelHeader`/`EmptyState`/`Skeleton`
- Produces: `export function EnvironmentToolingSection({ isAdmin = false })`

- [ ] **Step 1: Write the failing test**

```jsx
// tests/components/Settings/EnvironmentToolingSection.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { EnvironmentToolingSection } from '../../../src/components/Settings/EnvironmentToolingSection.jsx';

vi.mock('../../../src/utils/api', () => ({
  apiCall: vi.fn().mockResolvedValue({
    platform: 'linux',
    managers: { available: ['apt'], preferred: 'apt' },
    readiness: { ok: false },
    tools: [
      { id: 'git', label: 'Git', status: 'ok', version: '2.45.1' },
      { id: 'git-lfs', label: 'Git LFS', status: 'missing', version: null },
    ],
  }),
}));
vi.mock('../../../src/hooks/useToast', () => ({ useToast: () => ({ toast: { success: vi.fn(), errorFromException: vi.fn() } }) }));

describe('EnvironmentToolingSection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a row per tool with status', async () => {
    render(<EnvironmentToolingSection isAdmin />);
    await waitFor(() => expect(screen.getByText('Git LFS')).toBeInTheDocument());
    expect(screen.getByText('2.45.1')).toBeInTheDocument();
    expect(screen.getByText(/missing/i)).toBeInTheDocument();
  });

  it('shows the admin-only empty state for non-admins', async () => {
    render(<EnvironmentToolingSection isAdmin={false} />);
    await waitFor(() => expect(screen.getByText(/admin only/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/Settings/EnvironmentToolingSection.test.jsx`
Expected: FAIL — cannot resolve the component

- [ ] **Step 3: Write the component**

```jsx
// src/components/Settings/EnvironmentToolingSection.jsx
import { useState, useCallback } from 'react'
import { ShieldAlert, RefreshCw, Download, CheckCircle2, AlertTriangle, XCircle, MinusCircle } from 'lucide-react'
import { apiCall } from '../../utils/api'
import { useToast } from '../../hooks/useToast'
import { useTabData } from '../../hooks/useTabData.js'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { Skeleton } from '../ui/Skeleton'
import { PanelHeader } from '../ui/PanelHeader'

const STATUS_META = {
  ok:        { Icon: CheckCircle2, accent: 'text-emerald-500', label: 'OK' },
  outdated:  { Icon: AlertTriangle, accent: 'text-amber-500',  label: 'Outdated' },
  missing:   { Icon: XCircle,       accent: 'text-red-500',     label: 'Missing' },
  'n/a':     { Icon: MinusCircle,   accent: 'text-slate-400',   label: 'N/A' },
}

export function EnvironmentToolingSection({ isAdmin = false }) {
  const { toast } = useToast()
  const [installingId, setInstallingId] = useState(null)
  const { data, loading, error, reload } = useTabData(() => apiCall('/api/env/tooling'), [])

  const install = useCallback(async (id, label) => {
    setInstallingId(id)
    try {
      await apiCall(`/api/env/tooling/${id}/install`, { method: 'POST' })
      toast.success(`${label} install triggered`)
      await reload()
    } catch (err) {
      toast.errorFromException(err, { fallbackTitle: 'Install failed' })
    } finally {
      setInstallingId(null)
    }
  }, [reload, toast])

  if (!isAdmin) {
    return <EmptyState icon={ShieldAlert} title="Admin only" description="Migration tooling management is restricted to operator (admin) accounts." />
  }
  if (loading) {
    return <div className="space-y-3">{[0, 1, 2, 3].map((k) => <Skeleton key={k} variant="card" className="h-16" />)}</div>
  }
  if (error) {
    return <EmptyState icon={AlertTriangle} title="Couldn't load tooling status" description={error.message} action={{ label: 'Retry', onClick: reload }} />
  }

  const tools = data?.tools ?? []
  const preferred = data?.managers?.preferred

  return (
    <div className="space-y-5">
      <PanelHeader
        eyebrow="Migration tooling"
        title={data?.readiness?.ok ? 'All required tools ready' : 'Some tools need attention'}
        description={`Platform ${data?.platform} · package manager ${preferred ?? 'none detected'}`}
        actions={<Button variant="secondary" size="sm" onClick={reload}><RefreshCw className="w-3.5 h-3.5" /> Refresh</Button>}
      />
      <div className="space-y-2">
        {tools.map((t) => {
          const meta = STATUS_META[t.status] ?? STATUS_META['n/a']
          const canInstall = (t.status === 'missing' || t.status === 'outdated') && t.status !== 'n/a'
          return (
            <Card key={t.id} glass={false} shadow="sm" className="p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <meta.Icon className={`w-4 h-4 ${meta.accent}`} aria-hidden="true" />
                <span className="font-semibold">{t.label}</span>
                {t.version && <span className="ds-text-meta text-slate-400 tabular-nums">{t.version}</span>}
              </div>
              <div className="flex items-center gap-2">
                <span className={`ds-text-meta uppercase tracking-wide ${meta.accent}`}>{meta.label}</span>
                {canInstall && preferred && (
                  <Button variant="primary" size="sm" disabled={installingId === t.id} onClick={() => install(t.id, t.label)}>
                    <Download className={`w-3.5 h-3.5 ${installingId === t.id ? 'animate-pulse' : ''}`} /> Install
                  </Button>
                )}
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the component test**

Run: `npx vitest run tests/components/Settings/EnvironmentToolingSection.test.jsx`
Expected: PASS

- [ ] **Step 5: Wire the section into the Settings page**

Find the host page: `grep -rn "ProbeStatsSection" src/` → import and render `<EnvironmentToolingSection isAdmin={isAdmin} />` in the same admin/operator area (pass the existing `isAdmin` prop already threaded to `ProbeStatsSection`).

- [ ] **Step 6: Commit**

```bash
git add src/components/Settings/EnvironmentToolingSection.jsx tests/components/Settings/EnvironmentToolingSection.test.jsx src/components/Settings/
git commit -m "feat(env): operator Settings panel for migration tooling"
```

---

## Final verification

- [ ] **Run the full env suite + linters**

Run: `npx vitest run server/__tests__/env tests/components/Settings/EnvironmentToolingSection.test.jsx server/__tests__/env-routes.test.js server/__tests__/migration-preflight.test.js`
Expected: PASS

Run: `npm run lint`
Expected: 0 warnings.

- [ ] **Smoke the doctor end-to-end**

Run: `npm run doctor`
Expected: readiness table; exit 0 when git present.

---

## Self-Review

**Spec coverage:**
- Engine (registry/detect/package-managers/installer/readiness) → Tasks 1–6. ✓
- Fold-in of `better-sqlite3` native check → *note:* the spec lists it as an optional readiness row. It is **deferred** from v1 tasks to keep scope tight (the existing `postinstall` check already covers it); add as a follow-up registry entry with a custom detect (ABI probe) + `npm rebuild` installer. Flagged here so it isn't silently dropped.
- Unification refactor of the three lazy checks → Task 7. ✓
- CLI doctor → Task 8. ✓
- `/api/env` + SaaS install gating (env flag + requireAdmin) → Task 9. ✓
- Migration preflight → Task 10. ✓
- Settings UI → Task 11. ✓
- Security (no injection, no elevation, sanitize, audit, admin gate) → Tasks 4/5/9. ✓

**Placeholder scan:** no TBD/TODO; every code step has complete code. The one explicit deferral (`better-sqlite3` row) is called out, not left as a silent placeholder.

**Type consistency:** `DetectResult` shape is identical across detect/readiness/routes/UI; `installTool` returns the `InstallResult` consumed by the route's SSE and the doctor; `buildInstallCommand` returns `{cmd,args}` used by both installer and doctor; `EnvironmentError{code,tool,fix,docsUrl}` is produced in Task 6 and consumed in Task 10.
