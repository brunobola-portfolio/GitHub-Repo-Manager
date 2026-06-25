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
