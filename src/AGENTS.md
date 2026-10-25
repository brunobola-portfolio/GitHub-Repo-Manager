# src/AGENTS.md — frontend rules

Applies to everything under `src/`. The root `AGENTS.md` still applies.

## Structure and contracts

- `.jsx` for components, `.js` for utilities. Vite resolves by explicit
  extension: an `App.jsx` import never loads an `App.tsx`.
- `useGitHub`'s return object must keep every name `App.jsx` destructures from
  it. Removing one breaks the app at runtime, not at build time.
- Mock layer `src/__mocks__/` is dev-only and dynamic-imported behind
  `import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true'`. Inline
  that guard at every callsite; an alias defeats Vite's dead-code elimination
  and ships the mocks.
- Events: `emitAppEvent` / `onAppEvent` with names registered in `APP_EVENTS`
  (`src/utils/appEvents.js`). Never `window.dispatchEvent`.
- Mutating API calls and AI client calls go through `csrfFetch`
  (`src/utils/api.js`), which retries once on CSRF token rotation.
- A fire-and-forget `fetch` must still read its body
  (`await res.text().catch(() => {})`). `/api/*` is `no-store`, and an unread
  body keeps the request open, so Playwright's `networkidle` never settles.
- Popovers and menus close through `useDismiss` (`src/hooks/useDismiss.js`).
  Rendered markdown uses `buildGitHubSchema(prefix)`
  (`src/utils/githubMarkdownSchema.js`).
- Support and sales contacts come from `src/utils/supportContact.js`. Never
  hardcode a mailbox in a component.

## Components

- Reuse the canonical primitives before writing new UI: `SectionPanel`,
  `EmptyState`, `Badge`, `Tooltip`, `Spinner`, `PageHeader`, `Kbd`,
  `AIErrorState`, `QuotaExceededState`.
- Dropdowns use `Select` (`src/components/ui/Select.jsx`), never a native
  `<select>`. `onChange` receives the value, not an event. It renders a
  `role="combobox"` button, so tests click it and then click the `option`;
  `fireEvent.change` and Playwright `selectOption()` do not work on it.
- Cards in a grid need `h-full` on BOTH the motion wrapper and the `Card`, or
  the row goes ragged when one sibling's text wraps.
- Framer Motion only through `src/components/ui/motion.js`
  (DURATION / EASE / SPRING / TRANSITION); never hardcode spring or easing
  values. No hover scale or translate on flat elements.

## Styling and accessibility

- Tailwind utilities. Design-system classes are the opt-in `ds-*` set in
  `src/design-system.css`. Never global CSS element selectors.
- Dark mode is the `.dark` class on `<html>`. The axe e2e suite blocks on
  color contrast in BOTH themes, but only on the views it scans; anything else
  is unverified until you check it.
- Muted text: `text-slate-500 dark:text-slate-400` (AA on both themes). The
  reverse pair fails AA in both themes and is allowed only on decorative icons
  (`aria-hidden`, or next to a visible label). An icon that is the only
  content of a control needs a darker light-mode token.
- One accent ramp: `brand-*` (`src/index.css`). `indigo`, `violet`, `purple`,
  `fuchsia`, `sky`, `cyan`, `pink` and `teal` are retired and gated by
  `tests/build/no-off-brand-palette.test.js`. `emerald`, `amber`, `rose` and
  `slate` stay because they carry status.
- Never dim white on a brand fill (`text-white/90` is 4.43:1 and fails the
  axe gate). Use full white or a `--ds-badge-*` fill/text pair.
- Risk colours come from `src/utils/riskTokens.js` and the `ds-risk-*` tokens:
  500-level fills are for graphics; text uses `--ds-risk-*-text`.

## Brand

- The mark is generated: `src/components/ui/BrandMark.jsx` comes from
  `scripts/gen-brand.mjs`. Render it through `AppLogo` (tile) or `AppLogoIcon`
  (bare) and pass the real pixel size, because it picks its own optical cut
  (display at 25 px and up, small at 24 px and below). Never draw its paths.
- Never hand-edit `brand/` or `public/logo.svg`: change `scripts/gen-brand.mjs`,
  run `npm run gen:brand`, commit the outputs together.
- Brand lime `#7fc528` is a fill only, never text, and never means "healthy"
  (semantic green does). The BolaLabs flask is the company mark, never the
  product icon. Full rules: `docs/BRAND.md`.
