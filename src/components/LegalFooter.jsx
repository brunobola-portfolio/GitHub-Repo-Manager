/**
 * Provenance footer.
 *
 * It began as the AGPL §13 source offer, which the licence made mandatory.
 * Apache-2.0 makes it optional, and it stays: a person looking at a deployment
 * should be able to reach the source it was built from without asking anyone.
 *
 * The second link points at the subscription terms, not at a "commercial
 * licence" — under Apache-2.0 nobody needs permission to use this, so selling
 * permission would be selling nothing. It also points into the repository
 * rather than at the marketing site's /license path, which does not exist.
 *
 * Kept deliberately minimal so it doesn't compete with the product UI.
 */
const SOURCE_URL = 'https://github.com/brunobola-portfolio/GitHub-Repo-Manager'
const SUBSCRIPTION_URL = `${SOURCE_URL}/blob/main/docs/LICENSE-COMMERCIAL.md`

export function LegalFooter() {
  return (
    <footer
      aria-label="Legal and source-code attribution"
      // The floating assistant rests over this footer at the end of the
      // document — it is fixed, the footer is not, so at the bottom of a page
      // they want the same pixels. pr-20 keeps the right-aligned links clear of
      // the mobile FAB stack sideways; --ds-fab-safe-bottom reserves the strip
      // the desktop one comes to rest in, so it covers empty space rather than
      // "Status" and "Subscriptions".
      style={{ paddingBottom: 'var(--ds-fab-safe-bottom)' }}
      className="px-4 pr-20 md:pr-4 pt-2 ds-text-meta text-slate-500 dark:text-slate-400 border-t border-slate-200/60 dark:border-slate-800/60 bg-slate-50/60 dark:bg-slate-950/60"
    >
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span>
          GitHub Repo Manager — © Bola Labs ·{' '}
          <a
            href={SOURCE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-brand-600 dark:hover:text-brand-400 ds-focus-ring rounded"
          >
            Source code (AGPL v3)
          </a>
        </span>
        <div className="flex items-center gap-3">
          <a
            href="/status"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-brand-600 dark:hover:text-brand-400 ds-focus-ring rounded"
          >
            Status
          </a>
          <a
            href={SUBSCRIPTION_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-brand-600 dark:hover:text-brand-400 ds-focus-ring rounded"
          >
            Subscriptions
          </a>
        </div>
      </div>
    </footer>
  )
}

export default LegalFooter
