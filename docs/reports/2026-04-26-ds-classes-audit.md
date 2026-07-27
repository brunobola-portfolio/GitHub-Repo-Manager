# `ds-*` Class Audit — 2026-04-26

Auditor: `.dev/audit-ds-classes.mjs` (local-only, not tracked) — JS-native script that walks `src/` + `docs/` and tests each class with a word-boundary regex. Ignores the `design-system.css` definition file itself; cross-checks for `animation-name` / `@apply` references inside CSS.

## Headline

- **Total `ds-*` classes before:** 29
- **Orphans removed:** 6
- **Total after:** 23
- **CSS file size:** 485 → 422 lines (−63 lines, ~13% reduction)

## Removed classes

| Class | Reason |
|---|---|
| `ds-animate-slide-right` | Zero usages in jsx/js/css/md across `src/` + `docs/`. The `@keyframes ds-slide-in-right` it depended on was also removed. |
| `ds-animate-slide-left` | Zero usages. `@keyframes ds-slide-in-left` removed alongside. |
| `ds-modal-header` | Zero usages — the `Modal` primitive's title slot uses Tailwind directly, not this opt-in helper. |
| `ds-modal-footer` | Zero usages. The dark variant `:where(.dark) .ds-modal-footer` and the responsive `@media (min-width: 768px)` block were removed alongside. |
| `ds-focus-ring-offset` | Zero usages. Components default to Tailwind's `focus-visible:ring-2 focus-visible:ring-indigo-500` directly. |
| `ds-focus-ring-inset` | Zero usages. Same reason. |

## Retained but rare (1-2 usages)

| Class | Usages | Note |
|---|---|---|
| `ds-animate-float` | 1 file (docs only) | Only mentioned in `docs/specs/2026-04-11-modal-system-redesign.md`. **Likely orphan in actual code** — kept because the spec references it as available. Consider verifying after a follow-up component sweep. |
| `ds-glass-strong` | 1 file (`AIAssistant.jsx`) | Sole caller. Consider folding into Tailwind direct in that file if no other surfaces adopt it. |
| `ds-modal-body` | 2 files (`ConfirmModal`, others) | Used by the Modal primitive itself. Keep. |
| `ds-scrollbar` | 2 files | Two components use the premium scrollbar. Keep. |
| `ds-session-banner` | 1 file (`SessionBanner.jsx`) | Sole caller. Tightly coupled to that component. Keep but consider inlining. |
| `ds-stagger` | 1 file (docs only) | Only in spec docs. **Likely orphan in code** — kept pending verification. |
| `ds-transition-standard` | 2 files (docs only) | Only in spec/plan docs. **Likely orphan in code** — kept pending verification. |
| `ds-gradient-text-premium` | 2 files (`Landing/CTASection.jsx`) | Tight cluster. Keep. |
| `ds-hover-glow` | 3 files | Modest usage; keep. |
| `ds-hover-scale` | 4 files | Modest usage; keep. |

## Top usage (≥ 10 files)

These are working as the design system intends — opt-in helpers consumed widely:

- `ds-card-shimmer` (37 files)
- `ds-font-display` (31 files)
- `ds-btn-shimmer` (30 files)
- `ds-gradient-text` (18 files)
- `ds-hover-lift` (16 files)
- `ds-skeleton` (15 files)

## Verifications

After the cleanup:

- `npx vitest run` → 2728 tests passing (no regression)
- `npm run build` → exit 0, bundle still builds (CSS smaller by 63 lines)
- Re-running the audit script → 0 orphans

## Follow-ups

- [ ] Verify `ds-animate-float`, `ds-stagger`, `ds-transition-standard` aren't actually orphan in code (the docs-only matches may be misleading). Audit script counted them as "used" because of doc mentions; a stricter `--code-only` flag would catch this.
- [ ] Consider folding 1-usage classes (`ds-glass-strong`, `ds-session-banner`) into their callers' Tailwind directly. Single-use classes don't earn their abstraction cost.
- [ ] Re-run audit quarterly as part of routine code-health passes.

## Run to reproduce

```bash
node .dev/audit-ds-classes.mjs
```

Output: list of orphan + used classes with first-hit file. Script is gitignored (under `.dev/`).
