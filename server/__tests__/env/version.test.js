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
