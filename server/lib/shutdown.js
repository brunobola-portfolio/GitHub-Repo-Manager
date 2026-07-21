// SPDX-License-Identifier: AGPL-3.0-only
//
// Single-fire shutdown registry. index.js registers its gracefulShutdown
// closure here; both OS signal handlers and the managed-mode
// POST /api/system/shutdown route request shutdown through it, so a signal
// racing an API call can never run the teardown twice.
let handler = null;
let requested = false;

export function registerShutdown(fn) {
    handler = fn;
}

export function requestShutdown(reason) {
    if (requested || typeof handler !== 'function') return false;
    requested = true;
    handler(reason);
    return true;
}

export function resetShutdownForTests() {
    handler = null;
    requested = false;
}
