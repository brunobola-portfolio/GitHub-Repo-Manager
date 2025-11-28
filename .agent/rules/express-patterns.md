# Node.js/Express Backend Standards

## Project Structure

- Use ES Modules (`import`/`export`) consistently
- Import built-in modules with 'node:' prefix: `import { createServer } from 'node:http'`
- Organize routes logically; consider extracting to router modules when file exceeds 200 lines

## Error Handling

- Always use try/catch for async operations
- Create custom error classes for domain-specific errors
- Error-handling middleware must have 4 parameters: `(err, req, res, next)`
- Never expose stack traces or internal errors to clients in production
- Log errors with context (request ID, user, timestamp)

## Security

- Never store secrets in code; use environment variables
- Validate and sanitize all user input
- Use parameterized queries for any database operations
- Set appropriate CORS policies
- Use secure session configuration in production

## API Design - RESTful Conventions

- Use plural nouns for resources: `/api/repos`, `/api/orgs`
- Use HTTP methods appropriately: GET (read), POST (create), PUT/PATCH (update), DELETE (remove)
- Return appropriate status codes: 200 (OK), 201 (Created), 400 (Bad Request), 401 (Unauthorized), 404 (Not Found), 500 (Server Error)
- Include pagination for list endpoints

## Response Format

```javascript
// Success response
{ data: {...}, meta: { page: 1, total: 100 } }

// Error response
{ error: 'Human-readable message', code: 'MACHINE_READABLE_CODE' }
```

## Middleware Patterns

```javascript
// Authentication middleware pattern
function requireAuth(req, res, next) {
    if (!req.session.accessToken) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    next();
}

// Async handler wrapper to catch promise rejections
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};
```

## Express Route Template

```javascript
app.get('/api/resource/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const data = await fetchResource(id, req.session.accessToken);
        res.json({ data });
    } catch (error) {
        console.error(`Failed to fetch resource ${id}:`, error.message);
        res.status(error.status || 500).json({
            error: error.message || 'Internal server error'
        });
    }
});
```

