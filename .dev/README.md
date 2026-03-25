# .dev/ — Development & AI Tooling Files

This directory contains project-specific development artifacts that should travel with the repository, including AI assistant memory, implementation plans, and brainstorm outputs.

## Structure

```text
.dev/
├── README.md              ← You are here
├── screenshots/           Design references and visual validation screenshots
├── docs/                  Technical documentation drafts and local notes
├── plans/                 Local copies of implementation plans (reference)
├── checklists/            Validation and manual testing checklists
├── claude/
│   ├── memory/            Claude persistent memory for this project
│   │   └── MEMORY.md      Project context, architecture notes, lessons learned
│   └── plans/             Implementation plans generated during development
└── brainstorm/            Brainstorm session outputs (gitignored)
```

## What belongs here

- **Memory files** — Project context that helps AI assistants understand the codebase across sessions
- **Screenshots** — Design references, validation images, UI comparisons
- **Implementation plans** — Step-by-step plans for features and refactors
- **Checklists** — Manual testing and validation checklists
- **Architecture decisions** — Notes on why certain approaches were chosen

## Rules

1. Screenshots go ALWAYS in `screenshots/[page]/`
2. Documentation goes in `docs/[topic]/`
3. Never place loose files in the root of `.dev/`
4. This directory is local — not shared via git (except memory and plans)

## What does NOT belong here

- **Design specs** — Go in `docs/specs/`
- **Approved plans** — Go in `docs/plans/`
- **API docs** — Go in `docs/api/`
- **Test files** — Go in `tests/` or `e2e/`
- **Secrets or credentials** — Never committed
