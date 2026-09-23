// @vitest-environment node
/**
 * LFS detection on a real bare clone. It used to read info/attributes, which
 * `git clone --bare` never creates, so every LFS repo migrated with its LFS
 * files as pointers to missing objects. Needs only git (not git-lfs).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectLfsInBareRepo } from '../import-service.js';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
let root;

function makeBare(name, files, extraBranch) {
    const src = join(root, `${name}-src`);
    git(root, 'init', '-q', '-b', 'main', src);
    git(src, 'config', 'user.email', 't@example.com');
    git(src, 'config', 'user.name', 't');
    for (const [f, body] of Object.entries(files)) writeFileSync(join(src, f), body);
    git(src, 'add', '-A');
    git(src, 'commit', '-q', '-m', 'init');
    if (extraBranch) {
        git(src, 'checkout', '-q', '-b', extraBranch.name);
        for (const [f, body] of Object.entries(extraBranch.files)) writeFileSync(join(src, f), body);
        git(src, 'add', '-A');
        git(src, 'commit', '-q', '-m', 'branch');
    }
    const bare = join(root, `${name}.git`);
    git(root, 'clone', '-q', '--bare', src, bare);
    return (args) => Promise.resolve(git(bare, ...args));
}

beforeAll(() => { root = mkdtempSync(join(tmpdir(), 'lfs-detect-')); });
afterAll(() => { rmSync(root, { recursive: true, force: true }); });

describe('detectLfsInBareRepo', () => {
    it('finds filter=lfs in the tree of a bare clone', async () => {
        const run = makeBare('lfs', { '.gitattributes': '*.bin filter=lfs diff=lfs merge=lfs -text\n', 'a.txt': 'x' });
        expect(await detectLfsInBareRepo(run)).toBe(true);
    });

    it('finds it on a non-default branch only', async () => {
        const run = makeBare('branch', { 'a.txt': 'x' }, { name: 'assets', files: { '.gitattributes': '*.psd filter=lfs -text\n' } });
        expect(await detectLfsInBareRepo(run)).toBe(true);
    });

    it('is false for a repo with no LFS attributes', async () => {
        const run = makeBare('plain', { '.gitattributes': '*.sh text eol=lf\n', 'a.txt': 'x' });
        expect(await detectLfsInBareRepo(run)).toBe(false);
    });
});
