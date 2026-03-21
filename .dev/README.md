# .dev/ — Development & AI Tooling Files

This directory contains project-specific development artifacts that should travel with the repository, including AI assistant memory, implementation plans, and brainstorm outputs.

## Structure

```
.dev/
├── README.md              ← You are here
├── claude/
│   ├── memory/            Claude persistent memory for this project
│   │   └── MEMORY.md      Project context, architecture notes, lessons learned
│   └── plans/             Implementation plans generated during development
└── brainstorm/            Brainstorm session outputs (gitignored)
```

## What belongs here

- **Memory files** — Project context that helps AI assistants understand the codebase across sessions
- **Implementation plans** — Step-by-step plans for features and refactors
- **Architecture decisions** — Notes on why certain approaches were chosen

## What does NOT belong here

- **Design specs** — Go in `docs/specs/`
- **Approved plans** — Go in `docs/plans/`
- **API docs** — Go in `docs/api/`
- **Test files** — Go in `tests/` or `e2e/`
- **Secrets or credentials** — Never committed
