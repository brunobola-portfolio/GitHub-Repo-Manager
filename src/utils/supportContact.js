/**
 * Support contact shown in error fallbacks and on the pricing surfaces.
 *
 * Lives in its own module rather than src/config.js because dozens of tests
 * replace `@/config` with a factory mock, and a value read at module load
 * (the generic error fallback) would then throw in every one of them.
 *
 * Self-hosted deployments set VITE_SUPPORT_EMAIL at build time so their users
 * are not sent to the upstream maintainer's inbox.
 */
export const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || 'bruno@bolalabs.pt'
