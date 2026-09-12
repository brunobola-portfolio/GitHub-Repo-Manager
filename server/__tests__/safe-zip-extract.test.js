// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import AdmZip from 'adm-zip';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { extractZipSafely, isSymlinkEntry, resolveEntryPath } from '../lib/safe-zip-extract.js';

/*
 * The archives here are the attack, written byte by byte on purpose.
 *
 * adm-zip's own `addFile` cannot author them: it sanitises the entry name
 * (`../escaped.txt` is stored as `escaped.txt`, `/etc/x` as `etc/x`) and
 * discards the external attributes, so a test built on it feeds the extractor
 * a harmless archive and proves nothing. A hostile TFVC server is under no
 * such restraint — it writes the central directory itself, which is what
 * buildZip below does.
 *
 * adm-zip 0.6.0 is the latest release and the advisory has no fix, so these
 * assertions are the mitigation's only proof.
 */

const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c;
    }
    return table;
})();

const crc32 = (buf) => {
    let c = -1;
    for (let i = 0; i < buf.length; i += 1) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
    return (c ^ -1) >>> 0;
};

// Unix external attributes: 0x81a4 = regular file 0644, 0xa1ff = symlink 0777.
const ATTR_FILE = 0x81a40000;
const ATTR_SYMLINK = 0xa1ff0000;

/**
 * A stored (uncompressed) ZIP with exactly the names and attributes given.
 *
 * `declaredSize` writes an uncompressed size that does not match the data —
 * which is precisely what a zip bomb does, and the only way to exercise a
 * multi-gigabyte ceiling without allocating one.
 */
function buildZip(entries) {
    const locals = [];
    const centrals = [];
    let offset = 0;

    for (const entry of entries) {
        const name = Buffer.from(entry.name, 'utf8');
        const data = entry.data ?? Buffer.alloc(0);
        const crc = crc32(data);

        const declaredSize = entry.declaredSize ?? data.length;

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(declaredSize, 22);
        local.writeUInt16LE(name.length, 26);
        const localBlock = Buffer.concat([local, name, data]);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(0x031e, 4); // made by: unix
        central.writeUInt16LE(20, 6);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(data.length, 20);
        central.writeUInt32LE(declaredSize, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt32LE(entry.attr ?? ATTR_FILE, 38);
        central.writeUInt32LE(offset, 42);
        centrals.push(Buffer.concat([central, name]));

        locals.push(localBlock);
        offset += localBlock.length;
    }

    const directory = Buffer.concat(centrals);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(directory.length, 12);
    eocd.writeUInt32LE(offset, 16);

    return new AdmZip(Buffer.concat([...locals, directory, eocd]));
}

// Windows refuses symlink creation without elevation or developer mode, so
// the two tests that need a real link on disk skip there and run in CI, which
// is Linux. The rest of the suite — including every traversal case — runs
// everywhere.
const canSymlink = (() => {
    const probe = mkdtempSync(path.join(tmpdir(), 'symlink-probe-'));
    try {
        symlinkSync(probe, path.join(probe, 'link'), 'dir');
        return true;
    } catch {
        return false;
    } finally {
        rmSync(probe, { recursive: true, force: true });
    }
})();
const itWithSymlink = canSymlink ? it : it.skip;

let work;
let dest;
let outside;

beforeEach(() => {
    work = mkdtempSync(path.join(tmpdir(), 'safe-zip-'));
    dest = path.join(work, 'content');
    outside = path.join(work, 'outside');
    mkdirSync(dest, { recursive: true });
    mkdirSync(outside, { recursive: true });
});

afterEach(() => {
    rmSync(work, { recursive: true, force: true });
});

describe('extractZipSafely — the ordinary case still works', () => {
    it('writes files and nested directories', () => {
        const zip = buildZip([
            { name: 'README.md', data: Buffer.from('# hello') },
            { name: 'src/app/index.js', data: Buffer.from('export default 1') },
        ]);

        const { written, skipped } = extractZipSafely(zip, dest);

        expect(written).toBe(2);
        expect(skipped).toEqual([]);
        expect(readFileSync(path.join(dest, 'README.md'), 'utf8')).toBe('# hello');
        expect(readFileSync(path.join(dest, 'src', 'app', 'index.js'), 'utf8')).toBe('export default 1');
    });

    it('creates a directory entry without counting it as a file', () => {
        const zip = buildZip([
            { name: 'empty/', data: Buffer.alloc(0) },
            { name: 'empty/file.txt', data: Buffer.from('x') },
        ]);

        const { written, skipped } = extractZipSafely(zip, dest);

        expect(written).toBe(1);
        expect(skipped).toEqual([]);
        expect(existsSync(path.join(dest, 'empty', 'file.txt'))).toBe(true);
    });
});

describe('extractZipSafely — nothing lands outside the destination', () => {
    it('refuses a parent-directory hop', () => {
        const zip = buildZip([{ name: '../escaped.txt', data: Buffer.from('pwned') }]);

        const { written, skipped } = extractZipSafely(zip, dest);

        expect(written).toBe(0);
        expect(skipped).toEqual([{ name: '../escaped.txt', reason: 'outside destination' }]);
        expect(existsSync(path.join(work, 'escaped.txt'))).toBe(false);
    });

    it('refuses a hop that only escapes after descending', () => {
        const zip = buildZip([{ name: 'src/../../escaped.txt', data: Buffer.from('pwned') }]);

        const { written } = extractZipSafely(zip, dest);

        expect(written).toBe(0);
        expect(existsSync(path.join(work, 'escaped.txt'))).toBe(false);
    });

    it('refuses a backslash hop, which POSIX path handling reads as a filename', () => {
        // One level up, so the assertion lands inside this test's own sandbox:
        // asserting about the shared OS temp directory makes the test depend
        // on whatever else has ever run there.
        const zip = buildZip([{ name: '..\\escaped-win.txt', data: Buffer.from('pwned') }]);

        const { written, skipped } = extractZipSafely(zip, dest);

        expect(written).toBe(0);
        expect(skipped[0].reason).toBe('outside destination');
        expect(existsSync(path.join(work, 'escaped-win.txt'))).toBe(false);
    });

    it('refuses an absolute entry name instead of joining it', () => {
        const zip = buildZip([
            { name: '/etc/cron.d/evil', data: Buffer.from('pwned') },
            { name: 'C:/Windows/Temp/evil', data: Buffer.from('pwned') },
        ]);

        const { written, skipped } = extractZipSafely(zip, dest);

        expect(written).toBe(0);
        expect(skipped.map((s) => s.reason)).toEqual(['outside destination', 'outside destination']);
        expect(existsSync(path.join(dest, 'etc', 'cron.d', 'evil'))).toBe(false);
    });
});

describe('extractZipSafely — symlinks', () => {
    it('skips a symlink entry rather than recreating it', () => {
        const zip = buildZip([
            { name: 'link', data: Buffer.from('../outside'), attr: ATTR_SYMLINK },
            { name: 'keep.txt', data: Buffer.from('fine') },
        ]);

        const { written, skipped } = extractZipSafely(zip, dest);

        expect(written).toBe(1);
        expect(skipped).toEqual([{ name: 'link', reason: 'symlink' }]);
        expect(existsSync(path.join(dest, 'link'))).toBe(false);
        expect(readFileSync(path.join(dest, 'keep.txt'), 'utf8')).toBe('fine');
    });

    itWithSymlink('never writes through a symlink that is already at the destination', () => {
        // The advisory itself: the link exists, and the archive names a file
        // inside it.
        symlinkSync(outside, path.join(dest, 'nested'), 'dir');
        const zip = buildZip([{ name: 'nested/planted.txt', data: Buffer.from('pwned') }]);

        const { written, skipped } = extractZipSafely(zip, dest);

        expect(written).toBe(0);
        expect(skipped[0].reason).toBe('parent escapes destination');
        expect(existsSync(path.join(outside, 'planted.txt'))).toBe(false);
    });

    itWithSymlink('refuses to overwrite a file that is itself a symlink', () => {
        const victim = path.join(outside, 'victim.txt');
        writeFileSync(victim, 'original');
        symlinkSync(victim, path.join(dest, 'innocent.txt'));
        const zip = buildZip([{ name: 'innocent.txt', data: Buffer.from('pwned') }]);

        const { written, skipped } = extractZipSafely(zip, dest);

        expect(written).toBe(0);
        expect(skipped[0].reason).toBe('target is a symlink');
        expect(readFileSync(victim, 'utf8')).toBe('original');
    });
});

describe('extractZipSafely — names Windows would not treat as files', () => {
    it('refuses device names, with or without an extension', () => {
        const zip = buildZip([
            { name: 'CON', data: Buffer.from('x') },
            { name: 'nul.txt', data: Buffer.from('x') },
            { name: 'src/LPT1.js', data: Buffer.from('x') },
        ]);

        const { written, skipped } = extractZipSafely(zip, dest);

        expect(written).toBe(0);
        expect(skipped).toHaveLength(3);
    });

    it('refuses an alternate data stream, which hides content from every directory listing', () => {
        const zip = buildZip([{ name: 'notes.txt:hidden', data: Buffer.from('x') }]);

        const { written } = extractZipSafely(zip, dest);

        expect(written).toBe(0);
    });
});

describe('extractZipSafely — decompression ceilings', () => {
    it('refuses an entry whose declared size is past the per-entry limit, before expanding it', () => {
        const zip = buildZip([
            { name: 'bomb.bin', data: Buffer.from('tiny'), declaredSize: 5 * 1024 * 1024 },
            { name: 'ok.txt', data: Buffer.from('fine') },
        ]);

        const { written, skipped } = extractZipSafely(zip, dest, { maxEntryBytes: 1024 * 1024 });

        expect(written).toBe(1);
        expect(skipped).toEqual([{ name: 'bomb.bin', reason: 'entry too large' }]);
        expect(existsSync(path.join(dest, 'bomb.bin'))).toBe(false);
    });

    it('aborts when the archive expands past the total limit', () => {
        const zip = buildZip([
            { name: 'a.bin', data: Buffer.from('x'), declaredSize: 600 * 1024 },
            { name: 'b.bin', data: Buffer.from('x'), declaredSize: 600 * 1024 },
        ]);

        expect(() => extractZipSafely(zip, dest, { maxTotalBytes: 1024 * 1024 }))
            .toThrow(/total limit/i);
    });

    it('aborts on an absurd entry count before touching the disk', () => {
        const zip = buildZip([
            { name: 'a.txt', data: Buffer.from('x') },
            { name: 'b.txt', data: Buffer.from('x') },
        ]);

        expect(() => extractZipSafely(zip, dest, { maxEntries: 1 })).toThrow(/entries/i);
        expect(existsSync(path.join(dest, 'a.txt'))).toBe(false);
    });
});

describe('the helpers the extractor is built from', () => {
    it('reads the symlink bit from attr, not from adm-zip fileAttr', () => {
        // fileAttr masks with 0xfff and erases S_IFLNK, so a check written on
        // it would call this a regular file.
        expect(isSymlinkEntry({ header: { attr: ATTR_SYMLINK } })).toBe(true);
        expect(isSymlinkEntry({ header: { attr: ATTR_FILE } })).toBe(false);
        expect(isSymlinkEntry({})).toBe(false);
    });

    it('rejects the names that must never resolve', () => {
        const root = path.resolve(tmpdir(), 'root');
        expect(resolveEntryPath(root, '')).toBeNull();
        expect(resolveEntryPath(root, 'a\0b')).toBeNull();
        expect(resolveEntryPath(root, '../x')).toBeNull();
        expect(resolveEntryPath(root, 'a/../../x')).toBeNull();
        expect(resolveEntryPath(root, '.')).toBeNull();
        expect(resolveEntryPath(root, 'ok/file.txt')).toBe(path.join(root, 'ok', 'file.txt'));
    });
});
