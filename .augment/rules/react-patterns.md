---
type: auto
description: React component patterns and hooks best practices for frontend development
---

# React/Frontend Standards

## Component Structure

- Define components at module level, never inside other components
- Use function components with hooks (no class components)
- Export named functions, avoid default exports where possible
- Keep components focused on a single responsibility

## Hooks Best Practices

- Never call hooks conditionally or inside loops
- Never call hooks after early returns
- Wrap returned functions in useCallback when exposing from custom hooks
- Place all hook calls at the top of the component

## State Management

- Prefer local state (useState) over global state when possible
- Never mutate state directly; always use setter functions
- Create new objects/arrays instead of mutating existing ones

## Props

- Destructure props in function parameters
- Use optional chaining for optional callback props: `onAction?.(data)`
- Never mutate props or arguments passed to components

## Performance

- Memoize expensive computations with useMemo/useCallback
- Avoid creating functions inside render when they can be extracted
- Use pagination for large data sets
- Prefer native JavaScript methods over utility libraries when equivalent

## React Component Template

```jsx
import { useState, useCallback } from 'react';

export function ComponentName({ prop1, prop2, onAction }) {
    const [state, setState] = useState(null);

    const handleAction = useCallback(() => {
        onAction?.(state);
    }, [state, onAction]);

    if (!prop1) return null;

    return (
        <div className="component-name">
            {/* Component content */}
        </div>
    );
}
```

## Custom Hook Template

```javascript
import { useState, useEffect, useCallback } from 'react';

export function useCustomHook(dependency) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await fetchData(dependency);
            setData(result);
        } catch (err) {
            setError(err);
        } finally {
            setLoading(false);
        }
    }, [dependency]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    return { data, loading, error, refresh };
}
```

