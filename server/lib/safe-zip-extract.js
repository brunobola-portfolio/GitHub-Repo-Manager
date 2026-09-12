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
export function resolveEntryPath(destRoot, entryName) {
    const name = String(entryName || '').replace(/\\/g, '/');
    if (!name || name.includes('\0')) return null;
    // An absolute name (`/etc/x`, `C:/x`) must never be joined — path.resolve
    // would discard the destination entirely.
    if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return null;

    const target = path.resolve(destRoot, name);
    const rel = path.relative(destRoot, target);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return target;
}

/**
 * @param {{ getEntries: () => Array<object> }} zip an adm-zip instance
 * @param {string} destDir directory to extract into (created by the caller)
 * @returns {{ written: number, skipped: Array<{ name: string, reason: string }> }}
 */
export function extractZipSafely(zip, destDir) {
    const destRoot = path.resolve(destDir);
    // Compare real paths: if the destination itself is reached through a
    // symlink, every per-entry comparison below has to speak the same language
    // as the filesystem.
    const realRoot = existsSync(destRoot) ? realpathSync(destRoot) : destRoot;
    const skipped = [];
    let written = 0;

    for (const entry of zip.getEntries()) {
        const name = entry.entryName;

        if (isSymlinkEntry(entry)) {
            skipped.push({ name, reason: 'symlink' });
            continue;
        }

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
