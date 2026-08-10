// SPDX-License-Identifier: AGPL-3.0-only
// Scrub anything credential-shaped from captured child-process output before it
// crosses a trust boundary (API/SSE/logs). Mirrors git-tfs-runner.sanitizeStderr.

export function sanitizeOutput(raw) {
  if (!raw) return '';
  let out = String(raw);
  // The user half excludes ':' and both halves are bounded, so there is exactly
  // one way to split 'user:pass@' and the engine never backtracks across it.
  // The original pair of unbounded [^\s/@]+ runs either side of a ':' scanned
  // quadratically over long input that never reaches the '@' — and this runs on
  // captured child-process output, which an attacker can lengthen.
  out = out.replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^\s/@:]{1,256}:[^\s/@]{1,256}@/g, '$1***@');
  out = out.replace(/(authorization\s*:\s*)(bearer|basic)\s+\S+/gi, '$1$2 ***');
  // Known credential token families (GitHub PAT/OAuth/app tokens) — mask
  // regardless of character mix, since payloads can be all-lowercase.
  out = out.replace(/\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}\b/gi, '***');
  out = out.replace(/(?=[A-Za-z0-9_+/=-]*[A-Za-z])(?=[A-Za-z0-9_+/=-]*\d)[A-Za-z0-9_+/=-]{32,}/g, '***');
  return out;
}
