# File Creation Restrictions

## Prohibited Actions (Unless Explicitly Requested)

- NEVER create mock files, mock data, or stub implementations
- NEVER create test files or test scripts
- NEVER create fallback/failover methods or redundant safety mechanisms
- NEVER create documentation files (README.md, CONTRIBUTING.md, CHANGELOG.md, etc.)
- NEVER create configuration files beyond what's absolutely necessary
- NEVER create utility files "just in case" they might be useful
- NEVER create type definition files (.d.ts) unless TypeScript is being used

## File Creation Principle

Only create files that are **absolutely essential** to fulfill the specific user request.
When in doubt, ask the user before creating new files.

## Scope Discipline

- Do exactly what was requested; nothing more, nothing less
- Ask before creating new files
- Ask before making architectural changes
- Ask before installing new dependencies
- Never auto-commit or push without explicit permission

## When Editing Code

1. Make minimal changes necessary to achieve the goal
2. Preserve existing code style and patterns
3. Update all affected downstream code (callers, tests, types)
4. Search codebase to understand existing patterns before making changes

## Before Making Changes

1. Search codebase to understand existing patterns
2. Verify signatures and existence of dependencies
3. Check for existing similar implementations to maintain consistency

