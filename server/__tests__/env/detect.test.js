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

describe('detectAll', () => {
  it('honors the platform option', async () => {
    const { detectAll } = await import('../../lib/env/detect.js');
    const results = await detectAll({ runner: okGit('git version 2.45.1'), platform: 'linux' });

    const git = results.find((r) => r.id === 'git');
    const gitTfs = results.find((r) => r.id === 'git-tfs');

    expect(git.status).toBe('ok');
    expect(gitTfs.status).toBe('n/a');
  });
});
