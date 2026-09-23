import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import { buildGitHubSchema } from '../../utils/githubMarkdownSchema'

/**
 * GitHubMarkdown — renders a PR / issue / comment body the way GitHub does.
 *
 * Bodies written on GitHub (and by bots such as dependabot) lean on GFM
 * tables, task lists and inline HTML (`<details>`, `<summary>`, `<img
 * align>`); bare react-markdown printed the pipes and the escaped tags as
 * text. This is the README pipeline (`RepoMarkdown`) minus the relative-URL
 * rewriting, which needs an owner/repo/branch a comment does not carry.
 */
const SCHEMA = buildGitHubSchema('user-content-')

const REMARK_PLUGINS = [remarkGfm]
const REHYPE_PLUGINS = [rehypeRaw, [rehypeSanitize, SCHEMA]]

const COMPONENTS = {
    a: ({ node: _node, ...props }) => (
        // eslint-disable-next-line jsx-a11y/anchor-has-content -- children arrive through {...props} from react-markdown
        <a {...props} target="_blank" rel="noopener noreferrer" />
    ),
}

export const GitHubMarkdown = memo(function GitHubMarkdown({ children, className = '' }) {
    if (typeof children !== 'string' || children.length === 0) return null
    return (
        <div
            className={`prose prose-sm dark:prose-invert max-w-none break-words [&_a]:text-brand-600 dark:[&_a]:text-brand-400 [&_code]:bg-slate-100 dark:[&_code]:bg-slate-800 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-sm [&_code]:before:content-none [&_code]:after:content-none [&_pre]:bg-slate-100 dark:[&_pre]:bg-slate-800 [&_pre]:rounded-lg [&_pre]:p-4 [&_pre]:overflow-x-auto [&_table]:block [&_table]:overflow-x-auto [&_table]:text-xs [&_details]:rounded-lg [&_details]:border [&_details]:border-slate-200 dark:[&_details]:border-slate-700 [&_details]:px-3 [&_details]:py-2 [&_summary]:cursor-pointer [&_summary]:font-medium [&_img]:max-w-full ${className}`.trim()}
        >
            <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={COMPONENTS}>
                {children}
            </ReactMarkdown>
        </div>
    )
})
