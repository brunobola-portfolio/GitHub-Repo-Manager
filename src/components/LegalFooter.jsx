/**
 * AGPL §13 source-disclosure footer.
 *
 * The AGPL v3 ("Remote Network Interaction") clause requires SaaS users of a
 * modified version to be "prominently offered an opportunity to receive the
 * Corresponding Source." Showing a persistent link in the app shell satisfies
 * this. See https://www.gnu.org/licenses/agpl-3.0.en.html §13.
 *
 * Kept deliberately minimal so it doesn't compete with the product UI.
 */
const SOURCE_URL = 'https://github.com/brunobola-portfolio/GitHub-Repo-Manager'
const COMMERCIAL_URL = 'https://bolalabs.pt/license'

export function LegalFooter() {
  return (
    <footer
      aria-label="Legal and source-code attribution"
      // On mobile a stacked pair of FABs (search + quick-actions) sits at the
      // bottom-right; pr-20 keeps the right-aligned links out of their way.
      className="px-4 pr-20 md:pr-4 py-2 text-[11px] text-slate-500 dark:text-slate-500 border-t border-slate-200/60 dark:border-slate-800/60 bg-slate-50/60 dark:bg-slate-950/60"
    >
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span>
          GitHub Repo Manager — © Bola Labs ·{' '}
          <a
            href={SOURCE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-indigo-600 dark:hover:text-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-indigo-400 rounded"
          >
            Source code (AGPL v3)
          </a>
        </span>
        <div className="flex items-center gap-3">
          <a
            href="/status"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-indigo-600 dark:hover:text-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-indigo-400 rounded"
          >
            Status
          </a>
          <a
            href={COMMERCIAL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-indigo-600 dark:hover:text-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-indigo-400 rounded"
          >
            Commercial license
          </a>
        </div>
      </div>
    </footer>
  )
}

export default LegalFooter
