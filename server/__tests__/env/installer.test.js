// SPDX-License-Identifier: AGPL-3.0-only
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
