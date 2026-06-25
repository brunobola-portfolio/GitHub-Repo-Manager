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
    expect(requiresElevation('dnf', 'linux')).toBe(true);
    expect(requiresElevation('brew', 'darwin')).toBe(false);
  });
});
