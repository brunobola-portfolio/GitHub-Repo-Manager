/**
 * git-tfs runner — wraps the `git-tfs` CLI for TFVC → Git conversion when
 * the Azure DevOps Import Request API is not available (e.g. very old TFS
 * versions or import quota exhausted).
 *
 * Requirements (Windows only):
 *   - git-tfs in PATH (https://github.com/git-tfs/git-tfs)
 *   - Visual Studio Build Tools 2017+ with TFS Client OM
 *
 * On Linux/macOS `isAvailable()` returns false and the caller should skip
 * this strategy in the migration cascade.
 */

import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { execFile as execFileCb } from 'node:child_process';

const execFile = promisify(execFileCb);

let cachedAvailability = null;

/**
 * Check whether `git-tfs` is callable on this host.
 * Result is memoised for the lifetime of the process.
 *
 * @returns {Promise<boolean>}
 */
export async function isAvailable() {
  if (cachedAvailability !== null) return cachedAvailability;
  if (process.platform !== 'win32') {
    cachedAvailability = false;
    return false;
  }
  try {
    await execFile('git-tfs', ['--version'], { timeout: 5000 });
    cachedAvailability = true;
  } catch {
    cachedAvailability = false;
  }
  return cachedAvailability;
}

/** Reset the memoised availability flag (test seam only). */
export function _resetAvailabilityCache() {
  cachedAvailability = null;
}

/**
 * Clone a TFVC path to a local Git working copy using git-tfs.
 *
 * @param {object} opts
 * @param {string} opts.collectionUrl - TFS collection URL, e.g.
 *   "https://tfs.trigenius.com/tfs/DefaultCollection" or
 *   "https://dev.azure.com/contoso"
 * @param {string} opts.tfvcPath - TFVC server path, e.g. "$/Project/Folder"
 * @param {string} opts.pat - Azure DevOps PAT
 * @param {string} opts.outDir - empty directory to clone into
 * @param {boolean} [opts.fullHistory=true] - when false, uses --quick (single commit)
 * @param {(line: string, pct: number) => void} [opts.onProgress] - called on every stdout line
 * @returns {Promise<{ outDir: string, branchCount: number }>}
 */
export async function clone(opts) {
  const { collectionUrl, tfvcPath, pat, outDir, fullHistory = true, onProgress } = opts;

  if (!collectionUrl || !tfvcPath || !pat || !outDir) {
    throw new Error('git-tfs clone: collectionUrl, tfvcPath, pat, and outDir are required');
  }
  if (!tfvcPath.startsWith('$/')) {
    throw new Error('git-tfs clone: tfvcPath must start with $/');
  }
  if (!(await isAvailable())) {
    throw new Error('git-tfs is not available on this host');
  }

  const args = ['clone', collectionUrl, tfvcPath, outDir];
  if (!fullHistory) args.push('--quick');

  // git-tfs reads credentials from VS credential manager by default. For
  // non-interactive use we pass PAT via env var that git-tfs respects when
  // combined with `--username .` (Azure DevOps convention: any non-empty
  // username + PAT as password).
  args.push('--username', '.');
  // git-tfs reads --password from env GIT_TFS_PASSWORD when not supplied
  // (avoids leaking the PAT in `ps`).
  const env = { ...process.env, GIT_TFS_PASSWORD: pat };

  return new Promise((resolve, reject) => {
    const child = spawn('git-tfs', args, { env, windowsHide: true });

    let lastErr = '';
    let changesetCount = 0;
    let estimatedTotal = 0;

    const onLine = (line, isStderr) => {
      if (!line.trim()) return;
      if (isStderr) lastErr += line + '\n';

      // git-tfs emits lines like:
      //   "C12345 = abcdef0..."        (one per changeset)
      //   "Fetching changesets..."     (with possible total in next line)
      const csMatch = line.match(/^C(\d+)\s*=/);
      if (csMatch) {
        changesetCount += 1;
        const pct = estimatedTotal > 0
          ? Math.min(95, Math.floor((changesetCount / estimatedTotal) * 90))
          : Math.min(90, 5 + changesetCount); // rough fallback when total unknown
        onProgress?.(line, pct);
      } else {
        // Total announcement (varies by git-tfs version)
        const totalMatch = line.match(/(\d+)\s+changesets?\s+to\s+fetch/i);
        if (totalMatch) estimatedTotal = parseInt(totalMatch[1], 10);
        onProgress?.(line, Math.min(5, changesetCount));
      }
    };

    let stdoutBuf = '';
    let stderrBuf = '';
    child.stdout?.on('data', (chunk) => {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split(/\r?\n/);
      stdoutBuf = lines.pop() ?? '';
      for (const line of lines) onLine(line, false);
    });
    child.stderr?.on('data', (chunk) => {
      stderrBuf += chunk.toString();
      const lines = stderrBuf.split(/\r?\n/);
      stderrBuf = lines.pop() ?? '';
      for (const line of lines) onLine(line, true);
    });

    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ outDir, branchCount: 1 });
      } else {
        const msg = sanitizeStderr(lastErr.trim(), pat, code).slice(0, 500);
        reject(new Error(`git-tfs clone failed: ${msg}`));
      }
    });
  });
}

/**
 * Scrub anything that looks like a credential from a stderr blob before it
 * crosses a trust boundary (DB error_message, SSE stream, API response).
 *
 * - Removes literal occurrences of the PAT
 * - Masks token-shaped substrings (long alphanumerics, Bearer headers)
 * - Removes basic-auth userinfo from URLs
 */
function sanitizeStderr(raw, pat, exitCode) {
  if (!raw) return `git-tfs exited with code ${exitCode}`;
  let out = raw;
  if (pat) {
    // Replace literal PAT (any occurrence) with a fixed mask
    out = out.split(pat).join('***');
  }
  // user:pass@host  →  ***@host
  out = out.replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1***@');
  // Authorization: Bearer xyz  →  Authorization: ***
  out = out.replace(/(authorization\s*:\s*)(bearer|basic)\s+\S+/gi, '$1$2 ***');
  // Long base64-ish token-shaped runs (32+ chars) — mask conservatively.
  out = out.replace(/\b[A-Za-z0-9_\-+/=]{32,}\b/g, '***');
  return out;
}
