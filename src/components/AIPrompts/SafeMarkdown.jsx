import ReactMarkdown from 'react-markdown'
import { safeMarkdownProps } from './markdownConfig'

/**
 * Safely renders untrusted markdown (e.g. AI output) with GitHub-flavored
 * tables/strikethrough and rehype-sanitize for XSS hardening.
 *
 * Use ONLY for AI / user-supplied content. For trusted markdown (docs,
 * fixtures), regular ReactMarkdown without sanitization is fine. Call sites
 * that already provide their own `prose` wrapper should spread
 * `safeMarkdownProps` onto a bare <ReactMarkdown> instead of nesting this.
 */
export function SafeMarkdown({ children, className = '' }) {
    if (!children) return null
    return (
        <div className={`prose prose-sm dark:prose-invert max-w-none ${className}`}>
            <ReactMarkdown {...safeMarkdownProps}>
                {children}
            </ReactMarkdown>
        </div>
    )
}
