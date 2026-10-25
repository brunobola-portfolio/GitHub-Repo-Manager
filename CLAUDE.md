@AGENTS.md

## Claude Code

Everything above is shared with every coding agent. Only Claude-specific
mechanics belong here.

- `src/CLAUDE.md` and `server/CLAUDE.md` import their directory's `AGENTS.md`,
  so the scoped rules load once you touch a file there. Keep them as bare
  imports; the rules themselves go in the `AGENTS.md` files.
- Owner reports: when the root file calls for an HTML page, publish that same
  file as an Artifact. The local file is the copy; do not rewrite it as
  Markdown.
- `.claude/` holds local settings and is not shared.

<!-- Maintainers: run `/doctor prompt-audit` after large edits to the
instruction files, and `/context` to confirm which ones loaded. -->
