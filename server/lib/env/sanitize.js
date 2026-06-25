// SPDX-License-Identifier: AGPL-3.0-only
// Scrub anything credential-shaped from captured child-process output before it
// crosses a trust boundary (API/SSE/logs). Mirrors git-tfs-runner.sanitizeStderr.

export function sanitizeOutput(raw) {
  if (!raw) return '';
  let out = String(raw);
  out = out.replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1***@');
  out = out.replace(/(authorization\s*:\s*)(bearer|basic)\s+\S+/gi, '$1$2 ***');
  out = out.replace(/\b[A-Za-z0-9_\-+/=]{32,}\b/g, '***');
  return out;
}
