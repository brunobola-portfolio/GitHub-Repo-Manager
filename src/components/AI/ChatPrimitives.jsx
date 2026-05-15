/*
 * Shared chat primitives (slice 2).
 *
 * MessageBubble + TypingIndicator are reusable across:
 *   - AIAssistant (global assistant widget)
 *   - ChatTab    (PR-context chat)
 *
 * Kept tag-name and prop-shape compatible with the inline definitions in
 * AIAssistant.jsx so a future refactor can drop those in favour of these
 * without behaviour drift.
 */
import { Sparkles, AlertTriangle, ChevronRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

/**
 * MessageBubble — renders a single chat turn. Accepts a `message` shape:
 *   { role: 'user' | 'assistant' | 'tool', content?, text?, isError?, toolName?, toolInput? }
 *
 * Either `content` or `text` may carry the body — the latter matches the
 * legacy AIAssistant shape, the former matches the persisted server shape.
 */
export function MessageBubble({ message }) {
    const role = message?.role || 'assistant';
    const isUser = role === 'user';
    const isTool = role === 'tool';
    const isError = !!message?.isError;
    const body = (typeof message?.content === 'string' ? message.content : message?.text) || '';

    if (isTool) {
        return <ToolCallChip toolName={message?.toolName} input={message?.toolInput} output={body} />;
    }

    return (
        <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
            {!isUser && (
                <div className={`w-7 h-7 rounded-lg ${isError ? 'bg-rose-500' : 'bg-indigo-600 dark:bg-indigo-500'} flex items-center justify-center shrink-0 mt-0.5 mr-2 ring-1 ring-white/30 shadow-sm`}>
                    {isError
                        ? <AlertTriangle size={13} className="text-white" />
                        : <Sparkles size={13} className="text-white" />}
                </div>
            )}
            <div className="max-w-[82%] flex flex-col gap-2">
                <div
                    className={`px-3.5 py-2.5 text-sm leading-relaxed rounded-2xl shadow-sm ${
                        isUser
                            ? 'bg-indigo-600 dark:bg-indigo-500 text-white rounded-br-sm shadow-sm'
                            : isError
                                ? 'bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200 border border-rose-200 dark:border-rose-900/50 rounded-bl-sm'
                                : 'bg-white dark:bg-slate-800/90 text-slate-700 dark:text-slate-200 border border-slate-200/80 dark:border-slate-700/60 rounded-bl-sm prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-pre:my-2 prose-code:text-xs'
                    }`}
                >
                    {isUser ? body : <ReactMarkdown>{body}</ReactMarkdown>}
                </div>
            </div>
        </div>
    );
}

/**
 * Streaming bubble — a transient assistant bubble that renders partial text
 * as chunks arrive. Uses the same visual shell as MessageBubble so the
 * "settled" turn is visually identical post-stream.
 */
export function StreamingBubble({ text }) {
    return (
        <div className="flex justify-start">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 dark:bg-indigo-500 flex items-center justify-center shrink-0 mt-0.5 mr-2 ring-1 ring-white/30 shadow-sm">
                <Sparkles size={13} className="text-white" />
            </div>
            <div className="max-w-[82%] flex flex-col gap-2">
                <div className="px-3.5 py-2.5 text-sm leading-relaxed rounded-2xl shadow-sm bg-white dark:bg-slate-800/90 text-slate-700 dark:text-slate-200 border border-slate-200/80 dark:border-slate-700/60 rounded-bl-sm prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown>{text || '…'}</ReactMarkdown>
                </div>
            </div>
        </div>
    );
}

/**
 * TypingIndicator — three-dot bouncing animation for an in-flight reply
 * before the first chunk lands.
 */
export function TypingIndicator() {
    return (
        <div className="flex justify-start" aria-live="polite" aria-label="Assistant is typing">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 dark:bg-indigo-500 flex items-center justify-center shrink-0 mt-0.5 mr-2 ring-1 ring-white/30 shadow-sm">
                <Sparkles size={13} className="text-white" />
            </div>
            <div className="bg-white dark:bg-slate-800/90 px-3.5 py-3 rounded-2xl rounded-bl-sm border border-slate-200/80 dark:border-slate-700/60 shadow-sm">
                <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                    <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                    <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" />
                </div>
            </div>
        </div>
    );
}

/**
 * ToolCallChip — collapsed representation of a server-side tool call.
 *
 * Displayed when a `tool` role message lands in the persisted history. The
 * chat tab keeps these in the timeline so the user can audit what the
 * assistant fetched. Forward-compatible with the slice-2-tools follow-up.
 */
export function ToolCallChip({ toolName, input, output }) {
    const inputSummary = formatInputSummary(input);
    return (
        <details className="self-start inline-flex flex-col gap-1 my-1">
            <summary className="cursor-pointer inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-600">
                <ChevronRight size={11} />
                <span className="font-mono">{toolName || 'tool'}</span>
                {inputSummary ? <span className="text-slate-400 dark:text-slate-500 truncate max-w-[200px]">: {inputSummary}</span> : null}
            </summary>
            {output ? (
                <pre className="mt-1 max-w-full overflow-x-auto text-xs p-2 rounded bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 whitespace-pre-wrap">
                    {String(output).slice(0, 4000)}
                </pre>
            ) : null}
        </details>
    );
}

function formatInputSummary(input) {
    if (!input || typeof input !== 'object') return '';
    const entries = Object.entries(input).slice(0, 2);
    return entries.map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 40)}`).join(', ');
}
