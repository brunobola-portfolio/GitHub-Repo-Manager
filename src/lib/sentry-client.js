/*
 * The browser Sentry SDK, once main.jsx has loaded and initialised it.
 *
 * The SDK is imported on demand (only when the deployment configured a DSN),
 * so nothing may import '@sentry/react' statically: a single static import
 * pulls the whole package into the entry chunk every visitor downloads.
 * Code that wants to report reads the loaded module from here and no-ops
 * while it is null.
 */

let sentry = null

export function setSentry(module) {
    sentry = module
}

export function getSentry() {
    return sentry
}
