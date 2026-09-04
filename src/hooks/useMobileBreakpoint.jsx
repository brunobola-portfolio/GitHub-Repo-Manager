import { useBelowBreakpoint } from './useMediaQuery'

/**
 * True below the `md` breakpoint (`max-width: 767px`). Thin alias over the
 * shared {@link useBelowBreakpoint} primitive — kept as a named hook because
 * several modal/list surfaces (CreateRepoModal, MigrationWizard, RepoList,
 * RepoFilterBar) read it by this name.
 *
 * @returns {boolean}
 */
export function useMobileBreakpoint() {
  return useBelowBreakpoint('md')
}
