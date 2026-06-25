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
