// SPDX-License-Identifier: AGPL-3.0-only
// Pure semver-ish helpers for tool detection. No I/O.

/** Extract the first capture group of `regex` from `output`, or null. */
export function parseVersion(output, regex) {
  const m = String(output).match(regex);
  return m && m[1] ? m[1] : null;
}

/** Numeric, segment-wise compare. Missing segments count as 0. */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/** True when no min is required, or `version` is present and >= `min`. */
export function satisfiesMin(version, min) {
  if (!min) return true;
  if (!version) return false;
  return compareVersions(version, min) >= 0;
}
