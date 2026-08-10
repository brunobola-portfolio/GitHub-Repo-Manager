/*
 * Escape a string for use inside a double-quoted POSIX shell word.
 *
 * The DevToolkit shows a ready-to-paste `git commit -m "…"`. The app never
 * runs it — a human does, in their own terminal — which is exactly why it has
 * to be right: a message ending in a backslash used to swallow the closing
 * quote and turn the rest of the line into arguments.
 *
 * Inside double quotes the shell keeps interpreting four characters, so all
 * four are escaped: the backslash FIRST (escaping the delimiter without
 * escaping the escape is the bug this replaces), then the quote, then `$` and
 * the backtick, which would otherwise expand or run a command in a message
 * that came from a model.
 */
export function shellQuote(value) {
    return String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\$/g, '\\$')
        .replace(/`/g, '\\`');
}
