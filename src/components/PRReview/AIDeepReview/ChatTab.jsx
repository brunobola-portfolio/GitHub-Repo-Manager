import { useEffect, useRef, useState } from 'react';
import { Send, X, Trash2 } from 'lucide-react';
import { usePRChat } from '../../../hooks/usePRChat';
import { MessageBubble, StreamingBubble, TypingIndicator } from '../../AI/ChatPrimitives';
import { AIErrorState } from '../../ui/AIErrorState';
import { Button } from '../../ui/Button';
import { Textarea } from '../../ui/form';

/**
 * ChatTab — 4th tab of AIReviewPanel. Streaming PR-context chat.
 */
export function ChatTab({ owner, repo, prNumber, headSha }) {
    const {
        messages,
        loading,
        sending,
        streamingText,
        error,
        send,
        cancel,
        clear,
    } = usePRChat(owner, repo, prNumber);

    const [input, setInput] = useState('');
    const scrollRef = useRef(null);

    // Autoscroll to the bottom whenever the conversation grows.
    useEffect(() => {
        const node = scrollRef.current;
        if (!node) return;
        node.scrollTop = node.scrollHeight;
    }, [messages, streamingText, sending]);

    const onSubmit = async (e) => {
        e.preventDefault();
        const trimmed = input.trim();
        if (!trimmed || sending) return;
        setInput('');
        try { await send(trimmed); } catch { /* surfaced via error state */ }
    };

    const onClear = async () => {
        if (sending) cancel();
        try { await clear(); } catch { /* surfaced via error state */ }
    };

    const headShaShort = headSha ? String(headSha).slice(0, 7) : null;

    return (
        <div className="flex flex-col h-full min-h-0">
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 dark:border-slate-800 text-xs">
                <div className="text-slate-500 dark:text-slate-400">
                    Chat about PR #{prNumber}
                    {headShaShort ? <span className="ml-1.5 font-mono ds-text-meta">· {headShaShort}</span> : null}
                </div>
                <button
                    type="button"
                    onClick={onClear}
                    disabled={messages.length === 0 && !sending}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 disabled:opacity-40"
                    aria-label="Clear conversation"
                >
                    <Trash2 size={12} /> Clear
                </button>
            </div>

            <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
                {loading ? (
                    <div className="text-sm text-slate-500 dark:text-slate-400">Loading conversation…</div>
                ) : null}

                {!loading && messages.length === 0 && !sending ? (
                    <EmptyState prNumber={prNumber} />
                ) : null}

                {messages.map((m, idx) => (
                    <MessageBubble key={m.id ?? `${m.role}-${m.createdAt ?? idx}`} message={m} />
                ))}

                {sending && !streamingText ? <TypingIndicator /> : null}
                {sending && streamingText ? <StreamingBubble text={streamingText} /> : null}

                {error ? (
                    <AIErrorState
                        error={error}
                        onRetry={() => { /* user retypes — clearer UX than auto-retry */ }}
                        context="PR Chat"
                        variant="inline"
                    />
                ) : null}
            </div>

            <form onSubmit={onSubmit} className="border-t border-slate-200 dark:border-slate-800 p-2 flex items-end gap-2">
                <div className="flex-1">
                    <Textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                onSubmit(e);
                            }
                        }}
                        rows={2}
                        placeholder="Ask about this PR…"
                        aria-label="Chat message"
                        disabled={sending}
                    />
                </div>
                {sending ? (
                    <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={cancel}
                        aria-label="Cancel reply"
                    >
                        <X size={12} /> Cancel
                    </Button>
                ) : (
                    <Button
                        type="submit"
                        variant="primary"
                        size="sm"
                        disabled={!input.trim()}
                    >
                        <Send size={12} /> Send
                    </Button>
                )}
            </form>
        </div>
    );
}

function EmptyState({ prNumber }) {
    return (
        <div className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto pt-6 space-y-2">
            <p className="font-medium text-slate-700 dark:text-slate-200">Ask anything about PR #{prNumber}</p>
            <p>The assistant has the PR title, description, file list, and any prior AI walkthrough loaded as context. Try:</p>
            <ul className="list-disc pl-5 text-xs space-y-1">
                <li>“What does this PR change?”</li>
                <li>“Are there any obvious risks?”</li>
                <li>“Suggest a test plan for the new helper.”</li>
            </ul>
        </div>
    );
}
