/**
 * Extraction of an untrusted ZIP, entry by entry.
 *
 * adm-zip's own `extractAllTo` cannot be used on an archive we did not create:
 * 0.6.0 (the latest release — the advisory behind Dependabot alert #39 has no
 * patched version) writes through symlinks that already exist at the
 * destination, and it does not reject entry names that climb out of it. The
 * TFVC snapshot path feeds it a ZIP built by whatever Azure DevOps or TFS host
 * the caller named, so both of those are reachable by a compromised or hostile
 * source server.
 *
 * The rules below are deliberately blunt: anything that is not a plain file or
 * directory landing inside the destination is skipped and reported, never
 * "sanitised" into something adjacent. A TFVC checkout has no legitimate use
 * for a symlink, an absolute path or a parent-directory hop, so a skip here is
 * information about the source, not a loss for the user.
 */
import { existsSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from 'fs';
import path from 'path';

// Unix mode bits live in the top 16 of the external attributes; 0xa000 is
// S_IFLNK. adm-zip's own `fileAttr` getter masks with 0xfff, which erases
// exactly the nibble that distinguishes a symlink from a regular file — so the
// check has to read `attr` directly.
const S_IFMT = 0xf000;
const S_IFLNK = 0xa000;

/** True when the archive entry describes a symlink rather than a file. */
export function isSymlinkEntry(entry) {
    const attr = entry?.header?.attr ?? 0;
    return ((attr >>> 16) & S_IFMT) === S_IFLNK;
}

/**
 * Resolve an entry name against the destination, or return null when it does
 * not stay inside it.
 *
 * Backslashes are normalised first: a ZIP written on Windows can carry
 * `..\\..\\x`, which POSIX path handling treats as one long filename and
 * Windows treats as a traversal.
 */
// Windows treats these as devices, not files, wherever they appear in a path
// and whatever extension follows (`CON`, `nul.txt`); writing to one talks to
// the device. A colon inside a segment opens an alternate data stream
// (`a.txt:hidden`), which hides content from every tool that lists the
// directory. Neither has any place in a source checkout.
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** True when any path segment would be interpreted as something other than a file. */
function hasUnsafeSegment(name) {
    return name.split('/').some((seg) => WINDOWS_DEVICE.test(seg) || seg.includes(':'));
}

/**
 * Resolve an entry name against the destination, or return null when it does
 * not stay inside it.
 *
 * Backslashes are normalised first: a ZIP written on Windows can carry
 * `..\\..\\x`, which POSIX path handling treats as one long filename and
 * Windows treats as a traversal.
 */
export function resolveEntryPath(destRoot, entryName) {
    const name = String(entryName || '').replace(/\\/g, '/');
    if (!name || name.includes('\0')) return null;
    // An absolute name (`/etc/x`, `C:/x`) must never be joined — path.resolve
    // would discard the destination entirely.
    if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return null;
    if (hasUnsafeSegment(name)) return null;

    const target = path.resolve(destRoot, name);
    if (!isInside(destRoot, target)) return null;
    return target;
}

/**
 * Containment test by path segments, never by string prefix.
 *
 * `child.startsWith(root)` is true for a sibling that merely shares the
 * prefix — `…/content-x` passes for root `…/content` — so a destination with
 * such a neighbour would accept writes outside itself. path.relative answers
 * the question actually being asked.
 */
function isInside(root, target) {
    const rel = path.relative(root, target);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// Decompression ceilings. adm-zip decompresses an entry whole, in memory, so
// without a limit a small archive of compressible zeros expands until the
// process dies — and this server is one process serving every tenant. The
// numbers are far above any real source checkout (a 2 GB single file, 8 GB of
// total content, 200k files) and far below what a crafted archive would ask
// for. `header.size` is read from the central directory, so an entry is
// refused BEFORE its bytes are expanded.
const MAX_ENTRY_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024 * 1024;
const MAX_ENTRIES = 200_000;

/**
 * @param {{ getEntries: () => Array<object> }} zip an adm-zip instance
 * @param {string} destDir directory to extract into (created by the caller)
 * @param {{ maxEntryBytes?: number, maxTotalBytes?: number, maxEntries?: number }} [limits]
 * @returns {{ written: number, skipped: Array<{ name: string, reason: string }> }}
 */
export function extractZipSafely(zip, destDir, limits = {}) {
    const maxEntryBytes = limits.maxEntryBytes ?? MAX_ENTRY_BYTES;
    const maxTotalBytes = limits.maxTotalBytes ?? MAX_TOTAL_BYTES;
    const maxEntries = limits.maxEntries ?? MAX_ENTRIES;
    return extractEntries(zip, destDir, { maxEntryBytes, maxTotalBytes, maxEntries });
}

function extractEntries(zip, destDir, { maxEntryBytes, maxTotalBytes, maxEntries }) {
    const destRoot = path.resolve(destDir);
    // Compare real paths: if the destination itself is reached through a
    // symlink, every per-entry comparison below has to speak the same language
    // as the filesystem.
    const realRoot = existsSync(destRoot) ? realpathSync(destRoot) : destRoot;
    const skipped = [];
    let written = 0;
    let totalBytes = 0;

    const entries = zip.getEntries();
    if (entries.length > maxEntries) {
        throw new Error(`Archive declares ${entries.length} entries, above the ${maxEntries} limit.`);
    }

    for (const entry of entries) {
        const name = entry.entryName;

        if (isSymlinkEntry(entry)) {
            skipped.push({ name, reason: 'symlink' });
            continue;
        }

        // Read the declared uncompressed size from the central directory and
        // refuse before expanding anything: this is what stops one archive of
        // compressible zeros from taking the process down with it. A liar in
        // the header is caught by the running total below, after this entry.
        const declared = Number(entry.header?.size) || 0;
        if (declared > maxEntryBytes) {
            skipped.push({ name, reason: 'entry too large' });
            continue;
        }
        if (totalBytes + declared > maxTotalBytes) {
            throw new Error(`Archive expands past the ${maxTotalBytes}-byte total limit.`);
        }
        totalBytes += declared;

        const target = resolveEntryPath(realRoot, name);
        if (!target) {
            skipped.push({ name, reason: 'outside destination' });
            continue;
        }

        if (entry.isDirectory) {
            mkdirSync(target, { recursive: true });
            continue;
        }

        const parent = path.dirname(target);
        mkdirSync(parent, { recursive: true });
        // The parent is ours (just created, and no symlink entry ever gets
        // written), but an archive that lists a directory AFTER the file
        // inside it, or a destination that was not empty, could still route us
        // out through a link. Checking the realpath of the parent costs one
        // stat per entry and closes that.
        if (realpathSync(parent) !== parent && !realpathSync(parent).startsWith(realRoot)) {
            skipped.push({ name, reason: 'parent escapes destination' });
            continue;
        }
        if (existsSync(target) && lstatSync(target).isSymbolicLink()) {
            skipped.push({ name, reason: 'target is a symlink' });
            continue;
        }

        writeFileSync(target, entry.getData());
        written += 1;
    }

    return { written, skipped };
}
