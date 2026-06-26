// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { preflightTooling, migrationJobFromPlan } from '../routes/migration.js';

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
    missingLfs.mockClear();
    const job = { sourceType: 'github' };
    await expect(preflightTooling(job, { runner: missingLfs, platform: 'linux', force: true }))
      .resolves.toBeUndefined();
    expect(missingLfs).toHaveBeenCalled();
  });
});

describe('migrationJobFromPlan', () => {
  it('returns sizeStrategy lfs-migrate when a task config has lfs-migrate', () => {
    const plan = { source_type: 'github' };
    const tasks = [{ type: 'repo', config: JSON.stringify({ sizeStrategy: 'lfs-migrate' }) }];
    const result = migrationJobFromPlan(plan, tasks);
    expect(result.sizeStrategy).toBe('lfs-migrate');
  });

  it('returns sourceType azure-tfvc when a task has type repo-tfvc', () => {
    const plan = { source_type: 'github' };
    const tasks = [{ type: 'repo-tfvc', config: '{}' }];
    const result = migrationJobFromPlan(plan, tasks);
    expect(result.sourceType).toBe('azure-tfvc');
  });

  it('returns plain github shape for a plain repo task', () => {
    const plan = { source_type: 'github' };
    const tasks = [{ type: 'repo', config: '{}' }];
    const result = migrationJobFromPlan(plan, tasks);
    expect(result).toEqual({ sourceType: 'github', hasLFS: false, sizeStrategy: null });
  });

  it('does not throw and treats malformed task config as no-lfs', () => {
    const plan = { source_type: 'github' };
    const tasks = [{ type: 'repo', config: 'not json' }];
    expect(() => migrationJobFromPlan(plan, tasks)).not.toThrow();
    const result = migrationJobFromPlan(plan, tasks);
    expect(result.sizeStrategy).toBeNull();
  });
});
