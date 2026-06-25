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
