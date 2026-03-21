# Agent Rules - GitHub Repo Manager

> Cross-tool AI agent configuration following the [Agent Rules Standard](https://github.com/agent-rules/agent-rules)

## Project Identity

**GitHub Repo Manager** - Modern GitHub repository management dashboard with AI-powered insights, team collaboration features, and Azure DevOps migration capabilities.

**Stack**: React 19 + Vite (frontend), Node.js + Express (backend), SQLite (local database), Google Gemini AI

## Quick Reference

```bash
npm install          # Install dependencies
npm run dev:all      # Frontend (5173) + Backend (3001)
npm run dev          # Frontend only
npm run dev:server   # Backend only
```

---

## Core Principles

### 0. Critical Anti-Patterns

**NEVER Write Fake Code**
- MUST provide real, functional implementations
- MUST NOT use placeholders, stubs, or mock data unless explicitly requested
- MUST NOT add comments like "// TODO: implement later" without user permission
- If implementation is complex, ask for clarification rather than faking it

### 1. Code Quality Standards

**Comment Philosophy**
- Explain WHY, never WHAT (code shows what)
- Use technical terminology for experienced developers
- No conversational LLM style ("Let's...", "Here we...", "This will...")
- No emojis or exclamation marks in code
- Concise sentence fragments preferred

**Naming Conventions**
- Components: `PascalCase` (RepoList.jsx)
- Functions/variables: `camelCase` (getUserRepos)
- Constants: `SCREAMING_SNAKE_CASE` (MAX_RETRIES)
- Use semantic, descriptive names

**Import Organization**
1. React & core libraries
2. Third-party packages
3. Local components
4. Hooks & utilities
5. Types & constants

### 2. Architecture Boundaries

**React Components**
- Functional components only (no classes)
- Define at module level, never nested
- Export named functions (avoid default exports)
- Keep under 300 lines; split if larger
- Single responsibility principle

**State Management**
- Prefer local state (useState) over global
- Never mutate state directly
- Hooks at component top, never conditional

**Backend Structure**
- ES Modules (`import`/`export`) exclusively
- Node built-ins with 'node:' prefix: `import { createServer } from 'node:http'`
- RESTful API design with plural nouns
- Extract routes when file exceeds 200 lines

### 3. Design System

**Glassmorphism Theme**
- Semi-transparent backgrounds with `backdrop-blur-xl`
- Subtle borders: `border-white/10`, `border-slate-700`
- Layered shadows: `shadow-xl shadow-black/40`
- Generous rounded corners: `rounded-2xl`, `rounded-3xl`

**Dark Mode**
- Always implement Tailwind `dark:` variants
- Test both light and dark modes
- Default: `bg-slate-900` (dark), `bg-slate-50` (light)

**Styling**
- Tailwind utilities exclusively
- Avoid inline `style={{}}` unless truly dynamic
- Consistent spacing scale: 4, 6, 8, 12, 16, 24

### 4. Security & Performance

**Security First**
- Never commit secrets; use environment variables
- Validate and sanitize all user inputs
- Parameterized database queries only
- Never expose stack traces to clients
- Implement rate limiting on APIs

**Performance Optimizations**
- `React.memo()` for expensive components
- `useMemo`/`useCallback` for computations
- Pagination for large datasets
- Debounce search inputs (500ms)
- Lazy load heavy components

### 5. Testing & Verification

**Testing Requirements**
- MUST write tests when implementing new features or fixing bugs
- Run tests to verify functionality before marking task complete
- Use linting tools to ensure code quality (`npm run lint` or equivalent)
- Verify type safety if using TypeScript
- Test both success and error paths

**Test Directories**
- `tests/` — Frontend unit tests (Vitest), mirrors `src/` structure
- `e2e/` — End-to-end tests (Playwright)
- `server/__tests__/` — Backend unit tests (Vitest)
- NEVER place test files alongside source in `src/` or `server/`

**Verification Steps**
1. Read and understand the full scope before starting implementation
2. Trim scope to only what's explicitly requested
3. Implement with real, functional code
4. Run tests and linting
5. Verify in browser/terminal as applicable
6. Check for regressions in related functionality

### 6. Error Handling

**Frontend**
- Wrap async operations in try/catch
- User-friendly error messages via toasts
- Console logging for debugging
- Provide retry mechanisms

**Backend**
- Consistent error response format: `{ error: 'message', code: 'CODE' }`
- HTTP status codes: 200 (OK), 201 (Created), 400 (Bad Request), 401 (Unauthorized), 404 (Not Found), 500 (Server Error)
- Log with context (request ID, user, timestamp)

---

## File Creation Discipline

### Prohibited Actions (Unless Explicitly Requested)

- ❌ Never create `.md`, `.txt`, or documentation files
- ❌ Never create mock files, mock data, or stub implementations
- ❌ Never create test files outside designated directories (`tests/`, `e2e/`, `server/__tests__/`)
- ❌ Never create fallback/failover methods
- ❌ Never create "just in case" utilities
- ❌ Never create type definitions (.d.ts) unless TypeScript is used

### Documentation Files Policy

**Root Level (Essential for GitHub Repository)**
- `README.md` - Main project documentation
- `LICENSE` or `LICENSE.md` - Project license
- `AGENTS.md` - Cross-tool agent rules (this file)
- `CHANGELOG.md` - Version history
- `CONTRIBUTING.md` - Contribution guidelines

**docs/ Directory (Technical Documentation)**
- `docs/index.md` - Documentation map (start here to discover all docs)
- `docs/specs/` - Design specifications (`YYYY-MM-DD-feature-name.md`)
- `docs/plans/` - Implementation plans (generated from approved specs)
- `docs/architecture/` - System architecture docs
- `docs/api/` - API reference
- `docs/reports/` - Validation and analysis reports
- `docs/images/` - Screenshots and diagrams

**Implementation/ Folder (Hidden from Git via .gitignore)**
- Temporary analysis reports generated on user request
- Ad-hoc validation reports
- Temporary notes and studies
- **Will NOT be committed** to repository

**Principle**: Only create MD files that are essential project documentation for the GitHub repository. Temporary analysis belongs in `Implementation/`.

---

## Agent Communication Style

### Token Optimization

- **Be concise**: Avoid lengthy explanations unless requested
- **Code first**: Show code, don't over-explain it
- **Bullet points**: Use lists and short sentences
- **No fluff**: Skip "I'll help you", "Let me explain", "As you can see"
- **Direct**: State what was done, not what you'll do
- **Professional**: No flattery or unnecessary acknowledgments

### Examples

❌ **Bad (Verbose)**:
"I'll help you fix this issue. Let me start by analyzing the code structure and then I'll make the necessary changes to improve the functionality..."

✅ **Good (Concise)**:
"Fixed authentication bug in login handler."

---

## Technology-Specific Guidelines

### React 19

- Leverage new features (React Compiler, Server Components when applicable)
- Prefer `use` hook for async operations
- Avoid createClass and legacy patterns
- Use Suspense for loading states

### Vite 7

- Leverage native ES modules
- Use Vite's environment variable system (`import.meta.env`)
- Optimize build with code splitting

### TailwindCSS 4

- Use latest syntax and features
- Leverage CSS variables for theming
- Utilize `@apply` sparingly (prefer utility classes)

### SQLite (Better-SQLite3)

- Use prepared statements for security
- Implement transactions for bulk operations
- Create indexes for frequently queried columns

### Google Gemini API

- Implement fallback to mock responses when API key missing
- Cache AI analysis results in database
- Use `text-embedding-004` for embeddings
- Use `gemini-1.5-flash` for analysis

---

## Git Workflow

### Commit Messages

Format: `<type>(<scope>): <description>`

**Types**: feat, fix, docs, style, refactor, test, chore  
**Scopes**: frontend, backend, ai, teams, ui, config

**Examples**:
```
feat(ai): add semantic search for repositories
fix(backend): resolve session handling bug
docs(readme): update installation instructions
refactor(ui): extract Button component
```

### Do Not Commit

- `.env` and `.env.*` (except `.env.example`)
- `database.sqlite` and `*.db` files
- `node_modules/`
- `dist/` and build artifacts
- `rules/` and `augment rules/` directories
- `Implementation/` folder
- IDE files (`.idea/`, `.vscode/settings.json`)
- OS files (`.DS_Store`, `Thumbs.db`)

---

## Workflow Guidance

### Multi-Step Task Approach

1. **Read & Analyze**: Read full task requirements before starting
2. **Trim Scope**: Focus only on explicitly requested features
3. **Plan**: Break complex tasks into clear, manageable steps
4. **Implement**: Write real, functional code (no placeholders)
5. **Test**: Run tests and verify functionality
6. **Verify**: Check for regressions and edge cases
7. **Review**: Ensure code quality standards are met

### Agent Iteration

- SHOULD iterate on code through testing
- MUST write tests, run them, and verify proper functionality
- Use linting tools to catch errors early
- Provide clear explanations when changes affect architecture

---

## Before Making Changes

1. **Search codebase** to understand existing patterns
2. **Verify dependencies** - check signatures and existence
3. **Check implementations** - look for similar code
4. **Read artifact and trim scope** - focus on what's requested
5. **Minimal changes** - do exactly what's requested
6. **Preserve style** - match existing code patterns
7. **Update downstream** - fix affected code

**MUST NOT**:
- Auto-commit or push without permission
- Make architectural changes without asking
- Install dependencies without confirmation
- Create new files without necessity
- Write fake code or use placeholders

---

## Tool-Specific Configurations

- **Roo Code**: See `.roo/rules/project-rules.md` for detailed Roo-specific settings
- **Augment**: See `augment rules/rules.md` for Augment-specific guidelines
- **This File (AGENTS.md)**: Universal rules for all AI coding agents

---

## Support & Questions

For project-specific questions:
1. Check `README.md` for setup and features
2. Check `docs/index.md` for documentation map
3. Review `docs/specs/` for feature designs and `docs/plans/` for implementation plans
4. Examine existing code patterns
5. Ask maintainers for clarification

**Maintainer**: GitHub Repo Manager Team  
**License**: Check LICENSE file in repository root

---

*Last Updated: 2026-03-21*
*Agent Rules Version: 2.1 - Harmonized across Augment Code, Roo Code, Antigravity, and Claude Code*
