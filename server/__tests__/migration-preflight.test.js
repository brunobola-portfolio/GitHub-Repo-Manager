// @vitest-environment node
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
