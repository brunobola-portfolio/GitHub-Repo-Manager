// SPDX-License-Identifier: AGPL-3.0-only
// Scrub anything credential-shaped from captured child-process output before it
// crosses a trust boundary (API/SSE/logs). Mirrors git-tfs-runner.sanitizeStderr.

export function sanitizeOutput(raw) {
  if (!raw) return '';
  let out = String(raw);
  // Every run here is bounded, and the user half excludes ':' so there is
  // exactly one way to split 'user:pass@'. All three matter: the original had
  // unbounded runs either side of the ':', and an unbounded scheme meant a
  // long alphanumeric blob was rescanned in full from every start position.
  // This reads captured child-process output, which an attacker can lengthen.
  out = out.replace(/([a-zA-Z][a-zA-Z0-9+.-]{0,31}:\/\/)[^\s/@:]{1,256}:[^\s/@]{1,256}@/g, '$1***@');
  out = out.replace(/(authorization\s*:\s*)(bearer|basic)\s+\S+/gi, '$1$2 ***');
  // Known credential token families (GitHub PAT/OAuth/app tokens) — mask
  // regardless of character mix, since payloads can be all-lowercase.
  out = out.replace(/\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}\b/gi, '***');
  // Long mixed-alphabet blobs: match the run once, then ask what it contains.
  // The lookahead form this replaces rescanned the rest of the input from every
  // start position, so a 32 KB run of 'A' cost the better part of a second —
  // and nothing about that string is a credential.
  out = out.replace(/[A-Za-z0-9_+/=-]{32,}/g, (run) =>
    /[A-Za-z]/.test(run) && /\d/.test(run) ? '***' : run);
  return out;
}
