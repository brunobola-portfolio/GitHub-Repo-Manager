import { describe, it, expect } from 'vitest';
import {
  parseOversizedPushError,
  encodeOversizedError,
  decodeOversizedError,
  GITHUB_FILE_SIZE_LIMIT_BYTES,
  STRUCTURED_ERROR_PREFIX,
} from '../lib/oversized-blobs.js';

describe('GITHUB_FILE_SIZE_LIMIT_BYTES', () => {
  it('is exactly 100 MiB', () => {
    expect(GITHUB_FILE_SIZE_LIMIT_BYTES).toBe(100 * 1024 * 1024);
  });
});

describe('parseOversizedPushError', () => {
  it('returns null for unrelated stderr', () => {
    expect(parseOversizedPushError('fatal: not a git repository')).toBeNull();
  });

  it('returns null for null/undefined input', () => {
    expect(parseOversizedPushError(null)).toBeNull();
    expect(parseOversizedPushError(undefined)).toBeNull();
    expect(parseOversizedPushError('')).toBeNull();
  });

  it('extracts files from a real GH001 stderr block', () => {
    const stderr = `
To https://github.com/BolaLabs/AITOOL.git
 ! refs/heads/main:refs/heads/main [remote rejected] (pre-receive hook declined)
Done
Pushing to https://github.com/BolaLabs/AITOOL.git
POST git-receive-pack (chunked)
remote: error: Trace: abc
remote: error: See https://gh.io/lfs for more information.
remote: error: File Lib/StdMigrador100.dll is 214.70 MB; this exceeds GitHub's file size limit of 100.00 MB
remote: error: File Lib/StdMigrador100.dll is 197.20 MB; this exceeds GitHub's file size limit of 100.00 MB
remote: error: File Lib/StdMigrador100.dll is 210.76 MB; this exceeds GitHub's file size limit of 100.00 MB
remote: error: GH001: Large files detected.
error: failed to push some refs to 'https://github.com/BolaLabs/AITOOL.git'
`;
    const parsed = parseOversizedPushError(stderr);
    expect(parsed).not.toBeNull();
    expect(parsed.files).toHaveLength(3);
    expect(parsed.files[0]).toEqual({
      path: 'Lib/StdMigrador100.dll',
      sizeBytes: Math.round(214.7 * 1024 * 1024),
    });
    expect(parsed.files[2].sizeBytes).toBe(Math.round(210.76 * 1024 * 1024));
  });

  it('handles MB, GB and KB units', () => {
    const stderr = [
      "remote: error: File a.bin is 500.00 KB; this exceeds GitHub's file size limit of 100.00 MB",
      "remote: error: File b.bin is 250.50 MB; this exceeds GitHub's file size limit of 100.00 MB",
      "remote: error: File c.bin is 1.20 GB; this exceeds GitHub's file size limit of 100.00 MB",
    ].join('\n');
    const parsed = parseOversizedPushError(stderr);
    expect(parsed.files).toHaveLength(3);
    expect(parsed.files[0].sizeBytes).toBe(500 * 1024);
    expect(parsed.files[1].sizeBytes).toBe(Math.round(250.5 * 1024 ** 2));
    expect(parsed.files[2].sizeBytes).toBe(Math.round(1.2 * 1024 ** 3));
  });

  it('preserves paths with spaces and unicode', () => {
    const stderr = "remote: error: File some dir/Cobertura — relatório.pdf is 150.00 MB; this exceeds GitHub's file size limit of 100.00 MB";
    const parsed = parseOversizedPushError(stderr);
    expect(parsed.files[0].path).toBe('some dir/Cobertura — relatório.pdf');
  });
});

describe('encodeOversizedError / decodeOversizedError', () => {
  const files = [
    { path: 'big/a.dll', sizeBytes: 200 * 1024 ** 2 },
    { path: 'big/b.dll', sizeBytes: 150 * 1024 ** 2 },
  ];

  it('round-trips files and fallback message', () => {
    const encoded = encodeOversizedError(files, 'Push rejected.');
    expect(encoded.startsWith(STRUCTURED_ERROR_PREFIX)).toBe(true);
    const decoded = decodeOversizedError(encoded);
    expect(decoded.files).toEqual(files);
    expect(decoded.fallback).toBe('Push rejected.');
  });

  it('decode returns null for plain-text errors', () => {
    expect(decodeOversizedError('Some unrelated error')).toBeNull();
    expect(decodeOversizedError('')).toBeNull();
    expect(decodeOversizedError(null)).toBeNull();
  });

  it('decode tolerates missing fallback', () => {
    const encoded = `${STRUCTURED_ERROR_PREFIX}${JSON.stringify({ files })}`;
    const decoded = decodeOversizedError(encoded);
    expect(decoded.files).toEqual(files);
    expect(decoded.fallback).toBe('');
  });

  it('decode rejects malformed JSON payload', () => {
    expect(decodeOversizedError(`${STRUCTURED_ERROR_PREFIX}not-json|fallback`)).toBeNull();
  });

  it('decode rejects payload with non-array files', () => {
    const bad = `${STRUCTURED_ERROR_PREFIX}${JSON.stringify({ files: 'oops' })}|x`;
    expect(decodeOversizedError(bad)).toBeNull();
  });
});
