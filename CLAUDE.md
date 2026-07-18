@AGENTS.md

# CLAUDE.md — Claude Code addendum

Everything in AGENTS.md applies. The rules below are house-specific additions
for Claude Code sessions in this repository.

## Git commits & PRs (hard rules)

- NEVER add AI/tool attribution anywhere — no `Co-Authored-By` lines, no
  "Generated with Claude Code", no assistant footers — in commit messages, PR
  titles, or PR descriptions. Write as a human author would: what changed and
  why.
- Prefer a new commit over amending. Never skip hooks (`--no-verify`).
- Before `git add -A`: run `git status --short` and check for untracked
  artifact dirs (coverage/, dist/, .vite/) — gitignore first, never commit.
- Merging discipline: read `gh pr checks` for the LATEST run yourself before
  any merge — a `--watch` that exited green may have watched a stale run, and
  branch protection here does NOT block merges with failing checks.

## Documentation structure

- `docs/index.md` — map (start here) · `docs/specs/` — design specs
  (`YYYY-MM-DD-feature-name.md`) · `docs/plans/` — implementation plans ·
  `docs/architecture/` · `docs/api/` · `docs/reports/` — validation reports ·
  `docs/images/` — screenshots (`0X_description_hd.png`, captured at
  1920x1080).
- Specs and plans go ONLY in `docs/specs/` / `docs/plans/` — never invent
  custom subdirectories.

## Local workspace

- `.dev/` — gitignored scratch (drafts, checklists, screenshots, agent
  outputs). Never place loose files (PNG/PDF/MD) in the project root; never
  create temp folders outside `.dev/`.
- `.claude/` — local Claude Code settings; not shared.

## Editing discipline

- Always read files before Write/Edit (the tools enforce it — plan for it).
- Enhance existing complex components in place; never create replacement
  files (`App.tsx`-style rewrites) alongside the real ones.
- `useGitHub`'s return object must include every name `App.jsx` destructures
  from it — removing one breaks the app at runtime, not at build time.
- On Windows shells here, use `rm -f` semantics (Git Bash), not `del`.

## Verification bar

Before claiming work complete: targeted `npx vitest run` on touched test
files green, `npm run lint` clean, and for UI changes drive the real app
(mock mode: backend `NODE_ENV=test VITE_MOCK_MODE=true node server/index.js`
+ `npx vite --mode test`) rather than trusting tests alone. Evidence before
assertions.
