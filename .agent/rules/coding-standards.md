# Coding Standards

## Code Comment Standards

### Prohibited Comment Patterns
- NEVER use conversational LLM-style comments ("Let's add...", "Here we...", "This will...", "Now we need to...")
- NEVER use emojis in code comments
- NEVER use exclamation marks in comments
- NEVER write comments that describe WHAT the code does (the code itself shows that)

### Professional Comment Style
- Write comments that explain WHY, not WHAT
- Use technical terminology appropriate for experienced developers
- Keep comments concise and meaningful
- Use sentence fragments, not full sentences with subjects

Good examples:
```javascript
// Prevents race condition when multiple requests arrive simultaneously
// Required for OAuth 2.0 PKCE flow compliance
// GitHub API v3 requires this header for proper versioning
```

Bad examples:
```javascript
// Let's create a function to handle the login process
// Here we are setting up the middleware for authentication
// This will check if the user is logged in! 🔐
```

## Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Variables/Functions | camelCase | `getUserRepos`, `isAuthenticated` |
| Components | PascalCase | `RepoList`, `CreateRepoModal` |
| Constants | SCREAMING_SNAKE_CASE | `MAX_RETRIES`, `API_BASE_URL` |
| Files (components) | PascalCase.jsx | `Dashboard.jsx`, `RepoList.jsx` |
| Files (utilities) | camelCase.js | `api.js`, `useGitHub.js` |
| CSS classes | kebab-case | `repo-card`, `nav-item` |

## Code Organization

- Keep functions under 50 lines when possible
- Keep files under 300 lines; split if larger
- Group related functionality together
- Order: imports → constants → helpers → main exports

## Error Messages

- Be specific: `"Repository not found: ${repoName}"` not `"Not found"`
- Include actionable information when possible
- Use consistent error response format:
```javascript
{ error: 'Error message', code: 'ERROR_CODE', details: {} }
```

## SOLID Principles

- Single Responsibility: Each function/component does one thing well
- Open/Closed: Extend behavior through composition, not modification
- Liskov Substitution: Subtypes must be substitutable for base types
- Interface Segregation: Prefer small, focused interfaces
- Dependency Inversion: Depend on abstractions, not concretions

