// SPDX-License-Identifier: AGPL-3.0-only
// Scrub anything credential-shaped from captured child-process output before it
// crosses a trust boundary (API/SSE/logs). Mirrors git-tfs-runner.sanitizeStderr.

export function sanitizeOutput(raw) {
  if (!raw) return '';
  let out = String(raw);
  // Bounded repetitions: the unbounded pair scans quadratically over a long
  // run that never reaches the '@', and this runs on captured child-process
  // output an attacker can lengthen. No real userinfo segment is this long.
  out = out.replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^\s/@]{1,256}:[^\s/@]{1,256}@/g, '$1***@');
  out = out.replace(/(authorization\s*:\s*)(bearer|basic)\s+\S+/gi, '$1$2 ***');
  // Known credential token families (GitHub PAT/OAuth/app tokens) — mask
  // regardless of character mix, since payloads can be all-lowercase.
  out = out.replace(/\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}\b/gi, '***');
  out = out.replace(/(?=[A-Za-z0-9_+/=-]*[A-Za-z])(?=[A-Za-z0-9_+/=-]*\d)[A-Za-z0-9_+/=-]{32,}/g, '***');
  return out;
}
