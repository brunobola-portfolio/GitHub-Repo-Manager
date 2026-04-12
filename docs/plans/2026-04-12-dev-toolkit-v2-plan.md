# Dev Toolkit v2 — AI Assistant Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Dev Toolkit from a centered modal to an intelligent right-side panel with streaming AI, proactive suggestions, cross-tab context, and conversational refinement.

**Architecture:** Replace `DevToolkitModal.jsx` (which wraps the `Modal` component) with a new `DevToolkitPanel.jsx` that renders as a fixed right-side panel. Extend `useDevToolkit.js` with cross-tab context, auto-draft, and streaming state. Add SSE streaming to 4 existing backend AI endpoints plus 2 new endpoints. Build 7 new shared components for streaming output, refinement zone, smart context bar, etc.

**Tech Stack:** React 19, Framer Motion, Tailwind CSS v4, Express, Google Generative AI SDK (`@google/generative-ai`), Server-Sent Events

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/components/DevToolkit/DevToolkitPanel.jsx` | Main panel container — replaces DevToolkitModal |
| `src/components/DevToolkit/shared/StreamingOutput.jsx` | Terminal-style streaming text display with cursor |
| `src/components/DevToolkit/shared/RefinementZone.jsx` | Chips + chat input + version history |
| `src/components/DevToolkit/shared/ChatInput.jsx` | Text input for conversational refinement |
| `src/components/DevToolkit/shared/SmartContextBar.jsx` | AI-powered context insights bar |
| `src/components/DevToolkit/shared/RepoBadge.jsx` | Pin/unpin repo chip in header |
| `src/components/DevToolkit/shared/VersionHistory.jsx` | Collapsible refinement version stack |
| `src/hooks/useStreaming.js` | Reusable SSE streaming hook |
| `server/routes/ai-streaming.js` | Streaming helper utilities for SSE |

### Modified Files

| File | Changes |
|------|---------|
| `src/hooks/useDevToolkit.js` | Add cross-tab context, auto-draft, panel width, pin state |
| `src/components/DevToolkit/CommitTab/CommitTab.jsx` | Use streaming, StreamingOutput, RefinementZone |
| `src/components/DevToolkit/PRTab/PRTab.jsx` | Use streaming, cross-tab context, RefinementZone |
| `src/components/DevToolkit/ReviewTab/ReviewTab.jsx` | Add conversational Q&A, streaming summary |
| `src/App.jsx` | Swap DevToolkitModal for DevToolkitPanel |
| `server/routes/ai.js` | Add streaming support to 4 endpoints, add 2 new endpoints |

### Deprecated Files

| File | Reason |
|------|--------|
| `src/components/DevToolkit/DevToolkitModal.jsx` | Replaced by DevToolkitPanel.jsx |

---

## Task 1: Backend — SSE Streaming Helper

**Files:**
- Create: `server/routes/ai-streaming.js`

- [ ] **Step 1: Create the SSE streaming utility module**

```javascript
// server/routes/ai-streaming.js

/**
 * Initialize an SSE response — sets headers and returns helpers.
 * @param {import('express').Response} res
 * @returns {{ sendChunk: (text: string) => void, sendDone: (full: object) => void, sendError: (msg: string) => void }}
 */
export function initSSE(res) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
    });

    return {
        sendChunk(text) {
            res.write(`data: ${JSON.stringify({ text })}\n\n`);
        },
        sendDone(full) {
            res.write(`data: ${JSON.stringify({ done: true, full })}\n\n`);
            res.end();
        },
        sendError(message) {
            res.write(`data: ${JSON.stringify({ error: true, message })}\n\n`);
            res.end();
        },
    };
}

/**
 * Stream a Gemini generateContentStream result through SSE.
 * Accumulates text and returns the full string on completion.
 * @param {AsyncIterable} stream - Gemini stream result
 * @param {{ sendChunk: Function }} sse - SSE helpers from initSSE
 * @returns {Promise<string>} - The full accumulated text
 */
export async function streamGeminiToSSE(stream, sse) {
    let accumulated = '';
    for await (const chunk of stream.stream) {
        const text = chunk.text();
        if (text) {
            accumulated += text;
            sse.sendChunk(text);
        }
    }
    return accumulated;
}
```

- [ ] **Step 2: Commit**

```bash
git add server/routes/ai-streaming.js
git commit -m "feat(api): add SSE streaming helper utilities"
```

---

## Task 2: Backend — Add Streaming to generate-commit

**Files:**
- Modify: `server/routes/ai.js` (lines 694-766)

- [ ] **Step 1: Add import for streaming helpers at top of ai.js**

At the top of `server/routes/ai.js`, add:

```javascript
import { initSSE, streamGeminiToSSE } from './ai-streaming.js';
```

- [ ] **Step 2: Modify generate-commit endpoint to support streaming**

After the validation and usage-limit check (around line 734), add a streaming branch. The endpoint checks `req.query.stream === 'true'`. If true, use SSE; if false, keep existing behavior unchanged.

Replace the section from `const model = aiService.model;` to the `res.json(...)` call (lines 736-761) with:

```javascript
        const model = aiService.model;
        const chat = model.startChat({ history: [{ role: 'user', parts: [{ text: systemPrompt }] }, { role: 'model', parts: [{ text: '{"subject": "", "body": ""}' }] }] });

        if (req.query.stream === 'true') {
            const sse = initSSE(res);
            try {
                const streamResult = await chat.sendMessageStream(`Generate a commit message for this diff:\n\n${safeDiff}`);
                const raw = await streamGeminiToSSE(streamResult, sse);

                let parsed;
                try {
                    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
                    parsed = JSON.parse(cleaned);
                } catch {
                    parsed = { subject: raw.split('\n')[0], body: '' };
                }
                const message = parsed.body ? `${parsed.subject}\n\n${parsed.body}` : parsed.subject;

                await incrementUsage(userId, 'ai_queries');
                auditLog(req, 'ai_generate_commit', 'ai', { format, diff_length: diff.length, streamed: true });

                sse.sendDone({ message, subject: parsed.subject, body: parsed.body || '', format_used: format });
            } catch (err) {
                sse.sendError('Failed to generate commit message');
            }
            return;
        }

        // Non-streaming (existing behavior)
        const result = await chat.sendMessage(`Generate a commit message for this diff:\n\n${safeDiff}`);
        const raw = result.response.text().trim();
```

- [ ] **Step 3: Commit**

```bash
git add server/routes/ai.js
git commit -m "feat(api): add streaming support to generate-commit endpoint"
```

---

## Task 3: Backend — Add Streaming to generate-pr, review-summary, refine

**Files:**
- Modify: `server/routes/ai.js`

- [ ] **Step 1: Add streaming branch to generate-pr endpoint (lines 820-858)**

Same pattern as Task 2. After chat is created, check `req.query.stream === 'true'`. If true, stream the raw text, then parse on completion and send the structured result in the `done` event.

Insert streaming branch before the existing `const result = await chat.sendMessage(...)` line:

```javascript
        if (req.query.stream === 'true') {
            const sse = initSSE(res);
            try {
                const streamResult = await chat.sendMessageStream(
                    `Generate a PR description.\n\nCommits:\n${commitList}\n\nFiles changed:\n${filesInfo}\n\nPatches:\n${safePatches}`
                );
                const raw = await streamGeminiToSSE(streamResult, sse);

                let parsed;
                try {
                    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
                    parsed = JSON.parse(cleaned);
                } catch {
                    parsed = { title: commits[0]?.message?.split('\n')[0] || 'Update', summary: raw, test_plan: '', breaking_changes: null, related_issues: [], suggested_labels: [], suggested_reviewers: [] };
                }

                await incrementUsage(userId, 'ai_queries');
                auditLog(req, 'ai_generate_pr', 'ai', { commit_count: commits.length, streamed: true });

                sse.sendDone({
                    title: parsed.title || '', summary: parsed.summary || '', test_plan: parsed.test_plan || '',
                    breaking_changes: parsed.breaking_changes || null, related_issues: parsed.related_issues || [],
                    suggested_labels: parsed.suggested_labels || [], suggested_reviewers: parsed.suggested_reviewers || [],
                });
            } catch (err) {
                sse.sendError('Failed to generate PR description');
            }
            return;
        }
```

- [ ] **Step 2: Add streaming branch to refine endpoint (lines 908-922)**

Same pattern. Insert before `const result = await chat.sendMessage(...)`:

```javascript
        if (req.query.stream === 'true') {
            const sse = initSSE(res);
            try {
                const streamResult = await chat.sendMessageStream(
                    `Refinement instruction: ${instructionText}\n\nOriginal content:\n${original_content}${diffContext}`
                );
                const raw = await streamGeminiToSSE(streamResult, sse);

                await incrementUsage(userId, 'ai_queries');
                auditLog(req, 'ai_refine', 'ai', { instruction, content_type, streamed: true });

                sse.sendDone({ refined_content: raw.trim() });
            } catch (err) {
                sse.sendError('Failed to refine content');
            }
            return;
        }
```

- [ ] **Step 3: Add streaming to review-summary**

Find the review-summary endpoint in ai.js. Add the same streaming pattern. The review-summary uses `model.generateContent()` with a schema — for streaming, skip the schema and stream raw text, then parse on completion.

- [ ] **Step 4: Commit**

```bash
git add server/routes/ai.js
git commit -m "feat(api): add streaming support to generate-pr, refine, and review-summary"
```

---

## Task 4: Backend — New Endpoints (analyze-context, chat-refine)

**Files:**
- Modify: `server/routes/ai.js`

- [ ] **Step 1: Add analyze-context endpoint**

Add before the `export default router;` line:

```javascript
// ------------------------------------------------------------------
// Dev Toolkit — Analyze Context (Smart Bar)
// ------------------------------------------------------------------

const contextCache = new Map();
const CONTEXT_CACHE_TTL = 30000; // 30 seconds

router.post('/ai/analyze-context', requireAuth, requireAI, async (req, res) => {
    try {
        const { repo, diff_summary, commits, file_list } = req.body;

        if (!repo || !diff_summary) {
            return res.status(400).json({ error: 'repo and diff_summary are required' });
        }

        // Cache key: repo + file count + total changes
        const cacheKey = `${repo}_${diff_summary.files}_${diff_summary.additions}_${diff_summary.deletions}`;
        const cached = contextCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < CONTEXT_CACHE_TTL) {
            return res.json(cached.data);
        }

        const userId = req.session.userId;
        const limit = await checkUsageLimit(userId, 'ai_queries');
        if (!limit.allowed) {
            return res.status(429).json({ error: 'usage_limit_exceeded', message: 'AI query limit reached.' });
        }

        const commitMessages = (commits || []).map(c => c.message).join('\n');
        const files = (file_list || []).join(', ');

        const prompt = `Classify this code change. Respond with ONLY valid JSON:
{"changeType": "feature|bugfix|refactor|breaking|chore", "complexity": "low|medium|high", "breakingChanges": true|false}

Files: ${sanitizeForPrompt(files, 2000)}
Commits: ${sanitizeForPrompt(commitMessages, 2000)}
Stats: ${diff_summary.files} files, +${diff_summary.additions} -${diff_summary.deletions}`;

        const model = aiService.model;
        const result = await model.generateContent(prompt);
        const raw = result.response.text().trim();

        let parsed;
        try {
            parsed = JSON.parse(raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, ''));
        } catch {
            parsed = { changeType: 'chore', complexity: 'medium', breakingChanges: false };
        }

        // Check for open PRs on this repo (suggestions)
        const suggestions = [];
        if (commits && commits.length > 0) {
            suggestions.push({ type: 'generate_pr', message: `${commits.length} commit${commits.length > 1 ? 's' : ''} — generate PR description?`, tab: 'pr' });
        }
        if (parsed.breakingChanges) {
            suggestions.push({ type: 'breaking', message: 'Breaking changes detected — mark in commit', tab: 'commits' });
        }

        const responseData = {
            changeType: parsed.changeType || 'chore',
            complexity: parsed.complexity || 'medium',
            suggestions,
            breakingChanges: parsed.breakingChanges || false,
        };

        await incrementUsage(userId, 'ai_queries');
        contextCache.set(cacheKey, { data: responseData, timestamp: Date.now() });

        res.json(responseData);
    } catch (error) {
        req.log.error({ err: error }, 'Analyze context failed');
        res.status(500).json({ error: safeError(error, 'Failed to analyze context') });
    }
});
```

- [ ] **Step 2: Add chat-refine endpoint (always streaming)**

```javascript
// ------------------------------------------------------------------
// Dev Toolkit — Conversational Refine (always streaming)
// ------------------------------------------------------------------

router.post('/ai/chat-refine', requireAuth, requireAI, async (req, res) => {
    try {
        const { message, current_output, original_diff, content_type, history } = req.body;

        if (!message || typeof message !== 'string') {
            return res.status(400).json({ error: 'message is required' });
        }

        const userId = req.session.userId;
        const limit = await checkUsageLimit(userId, 'ai_queries');
        if (!limit.allowed) {
            return res.status(429).json({ error: 'usage_limit_exceeded', message: 'AI query limit reached.' });
        }

        const CONTENT_TYPE_LABELS = {
            commit: 'commit message',
            pr_summary: 'PR summary',
            pr_test_plan: 'PR test plan',
            review_qa: 'code review Q&A',
        };
        const typeLabel = CONTENT_TYPE_LABELS[content_type] || 'content';

        const safeDiff = original_diff ? sanitizeForPrompt(original_diff, 8000) : '';
        const diffCtx = safeDiff ? `\n\nDiff context:\n${safeDiff}` : '';

        const systemPrompt = `You are a helpful AI assistant refining ${typeLabel}. Apply the user's instruction to improve the content. Return ONLY the refined content, no explanation.${diffCtx}`;

        // Build chat history
        const chatHistory = [
            { role: 'user', parts: [{ text: systemPrompt }] },
            { role: 'model', parts: [{ text: 'Ready to help refine.' }] },
        ];

        // Add conversation history (max 5 exchanges)
        const safeHistory = Array.isArray(history) ? history.slice(-10) : [];
        for (const entry of safeHistory) {
            chatHistory.push({
                role: entry.role === 'user' ? 'user' : 'model',
                parts: [{ text: sanitizeForPrompt(entry.content, 4000) }],
            });
        }

        const model = aiService.model;
        const chat = model.startChat({ history: chatHistory });

        const userMessage = current_output
            ? `Current content:\n${sanitizeForPrompt(current_output, 6000)}\n\nInstruction: ${message}`
            : message;

        const sse = initSSE(res);
        try {
            const streamResult = await chat.sendMessageStream(userMessage);
            const raw = await streamGeminiToSSE(streamResult, sse);

            await incrementUsage(userId, 'ai_queries');
            auditLog(req, 'ai_chat_refine', 'ai', { content_type, message_length: message.length });

            sse.sendDone({ refined_content: raw.trim() });
        } catch (err) {
            sse.sendError('Failed to refine content');
        }
    } catch (error) {
        req.log.error({ err: error }, 'Chat refine failed');
        if (!res.headersSent) {
            res.status(500).json({ error: safeError(error, 'Failed to chat refine') });
        }
    }
});
```

- [ ] **Step 3: Commit**

```bash
git add server/routes/ai.js
git commit -m "feat(api): add analyze-context and chat-refine endpoints"
```

---

## Task 5: Frontend — useStreaming Hook

**Files:**
- Create: `src/hooks/useStreaming.js`

- [ ] **Step 1: Create the reusable streaming hook**

```javascript
// src/hooks/useStreaming.js
import { useState, useCallback, useRef } from 'react'

/**
 * Hook for consuming SSE streams from AI endpoints.
 * Returns streaming text, loading state, and controls.
 */
export function useStreaming() {
    const [streamingText, setStreamingText] = useState('')
    const [isStreaming, setIsStreaming] = useState(false)
    const [error, setError] = useState(null)
    const [result, setResult] = useState(null)
    const abortRef = useRef(null)

    const startStream = useCallback(async (url, body) => {
        // Abort any existing stream
        abortRef.current?.abort()
        const controller = new AbortController()
        abortRef.current = controller

        setStreamingText('')
        setIsStreaming(true)
        setError(null)
        setResult(null)

        try {
            const separator = url.includes('?') ? '&' : '?'
            const streamUrl = `${url}${separator}stream=true`

            const res = await fetch(streamUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal,
            })

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}))
                throw new Error(errData.message || errData.error || `Request failed: ${res.status}`)
            }

            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''

            while (true) {
                const { done, value } = await reader.read()
                if (done) break

                buffer += decoder.decode(value, { stream: true })
                const lines = buffer.split('\n')
                buffer = lines.pop() || ''

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue
                    const jsonStr = line.slice(6)
                    try {
                        const data = JSON.parse(jsonStr)
                        if (data.error) {
                            setError(data.message || 'Stream error')
                            setIsStreaming(false)
                            return null
                        }
                        if (data.done) {
                            setResult(data.full)
                            setIsStreaming(false)
                            return data.full
                        }
                        if (data.text) {
                            setStreamingText(prev => prev + data.text)
                        }
                    } catch { /* skip malformed chunks */ }
                }
            }

            setIsStreaming(false)
            return result
        } catch (err) {
            if (err.name === 'AbortError') {
                setIsStreaming(false)
                return null
            }
            setError(err.message || 'Streaming failed')
            setIsStreaming(false)
            return null
        }
    }, [])

    const cancelStream = useCallback(() => {
        abortRef.current?.abort()
        setIsStreaming(false)
    }, [])

    const reset = useCallback(() => {
        setStreamingText('')
        setIsStreaming(false)
        setError(null)
        setResult(null)
    }, [])

    return {
        streamingText,
        isStreaming,
        error,
        result,
        startStream,
        cancelStream,
        reset,
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useStreaming.js
git commit -m "feat(hooks): add useStreaming hook for SSE consumption"
```

---

## Task 6: Frontend — StreamingOutput Component

**Files:**
- Create: `src/components/DevToolkit/shared/StreamingOutput.jsx`

- [ ] **Step 1: Create StreamingOutput component**

This replaces `OutputSection.jsx` — a terminal-style streaming display with pulsing cursor and copy actions.

```jsx
// src/components/DevToolkit/shared/StreamingOutput.jsx
import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Copy, Check, Terminal, Square } from 'lucide-react'

export function StreamingOutput({ content, streamingText, isStreaming, onCancel, label = 'Generated Output' }) {
    const [copiedId, setCopiedId] = useState(null)
    const displayText = isStreaming ? streamingText : content

    const handleCopy = useCallback((text, id) => {
        navigator.clipboard.writeText(text)
        setCopiedId(id)
        setTimeout(() => setCopiedId(null), 2000)
    }, [])

    if (!displayText && !isStreaming) return null

    const gitCommand = displayText.includes('\n')
        ? `git commit -m "$(cat <<'EOF'\n${displayText}\nEOF\n)"`
        : `git commit -m "${(displayText || '').replace(/"/g, '\\"')}"`

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
            >
                <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</label>
                    {isStreaming && (
                        <button
                            type="button"
                            onClick={onCancel}
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs text-red-400 hover:text-red-300 rounded transition-colors"
                        >
                            <Square className="w-3 h-3" />
                            Stop
                        </button>
                    )}
                </div>
                <div className="relative group">
                    <div className="w-full px-4 py-4 bg-slate-950 text-emerald-400 rounded-xl font-mono text-sm leading-relaxed border border-slate-700/50 ring-1 ring-emerald-500/10 whitespace-pre-wrap min-h-[60px]">
                        {displayText}
                        {isStreaming && (
                            <span className="inline-block w-2 h-5 ml-0.5 bg-emerald-400 animate-pulse align-text-bottom" />
                        )}
                    </div>
                    {!isStreaming && displayText && (
                        <div className="absolute top-2.5 right-2.5 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                            <CopyBtn text={displayText} id="msg" copiedId={copiedId} onCopy={handleCopy} label="Copy message" />
                            <CopyBtn text={gitCommand} id="cmd" copiedId={copiedId} onCopy={handleCopy} label="Copy as git command" icon={Terminal} />
                        </div>
                    )}
                </div>
            </motion.div>
        </AnimatePresence>
    )
}

function CopyBtn({ text, id, copiedId, onCopy, label, icon: Icon = Copy }) {
    return (
        <button
            type="button"
            onClick={() => onCopy(text, id)}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-md transition-all"
            aria-label={label}
            title={label}
        >
            {copiedId === id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Icon className="w-3.5 h-3.5" />}
        </button>
    )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/DevToolkit/shared/StreamingOutput.jsx
git commit -m "feat(toolkit): add StreamingOutput component with cursor and copy"
```

---

## Task 7: Frontend — ChatInput & VersionHistory Components

**Files:**
- Create: `src/components/DevToolkit/shared/ChatInput.jsx`
- Create: `src/components/DevToolkit/shared/VersionHistory.jsx`

- [ ] **Step 1: Create ChatInput component**

```jsx
// src/components/DevToolkit/shared/ChatInput.jsx
import { useState, useCallback } from 'react'
import { SendHorizontal } from 'lucide-react'

export function ChatInput({ placeholder = 'Refine...', onSubmit, disabled }) {
    const [value, setValue] = useState('')

    const handleSubmit = useCallback(() => {
        const trimmed = value.trim()
        if (!trimmed || disabled) return
        onSubmit(trimmed)
        setValue('')
    }, [value, disabled, onSubmit])

    const handleKeyDown = useCallback((e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSubmit()
        }
    }, [handleSubmit])

    return (
        <div className="flex items-center gap-2">
            <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                disabled={disabled}
                className="flex-1 px-3 py-2 text-sm bg-slate-100 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 disabled:opacity-50 placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-all"
            />
            <button
                type="button"
                onClick={handleSubmit}
                disabled={disabled || !value.trim()}
                className="p-2 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                aria-label="Send"
            >
                <SendHorizontal className="w-4 h-4" />
            </button>
        </div>
    )
}
```

- [ ] **Step 2: Create VersionHistory component**

```jsx
// src/components/DevToolkit/shared/VersionHistory.jsx
import { useState } from 'react'
import { ChevronRight, Clock } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

export function VersionHistory({ versions = [], onRestore }) {
    const [expanded, setExpanded] = useState(false)

    if (versions.length === 0) return null

    return (
        <div>
            <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
            >
                <motion.span animate={{ rotate: expanded ? 90 : 0 }} transition={{ duration: 0.15 }}>
                    <ChevronRight className="w-3 h-3" />
                </motion.span>
                Version history ({versions.length})
            </button>
            <AnimatePresence>
                {expanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                    >
                        <div className="mt-2 space-y-1 max-h-40 overflow-y-auto custom-scrollbar">
                            {versions.map((v, i) => (
                                <button
                                    key={i}
                                    type="button"
                                    onClick={() => onRestore(v.content)}
                                    className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors group"
                                >
                                    <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                                    <span className="truncate text-slate-600 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-slate-200">
                                        {v.instruction || `v${versions.length - i}`}
                                    </span>
                                    <span className="ml-auto text-[10px] text-slate-400 shrink-0">{v.time}</span>
                                </button>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/DevToolkit/shared/ChatInput.jsx src/components/DevToolkit/shared/VersionHistory.jsx
git commit -m "feat(toolkit): add ChatInput and VersionHistory components"
```

---

## Task 8: Frontend — RefinementZone Component

**Files:**
- Create: `src/components/DevToolkit/shared/RefinementZone.jsx`

- [ ] **Step 1: Create RefinementZone — combines chips + chat input + version history**

```jsx
// src/components/DevToolkit/shared/RefinementZone.jsx
import { RefinementChips } from './RefinementChips'
import { ChatInput } from './ChatInput'
import { VersionHistory } from './VersionHistory'

export function RefinementZone({ chips, onChipSelect, onChatSubmit, disabled, placeholder, versions, onRestore }) {
    return (
        <div className="space-y-3">
            {chips && chips.length > 0 && (
                <RefinementChips chips={chips} onSelect={onChipSelect} disabled={disabled} />
            )}
            <ChatInput
                placeholder={placeholder || 'Refine...'}
                onSubmit={onChatSubmit}
                disabled={disabled}
            />
            <VersionHistory versions={versions || []} onRestore={onRestore} />
        </div>
    )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/DevToolkit/shared/RefinementZone.jsx
git commit -m "feat(toolkit): add RefinementZone composite component"
```

---

## Task 9: Frontend — RepoBadge Component

**Files:**
- Create: `src/components/DevToolkit/shared/RepoBadge.jsx`

- [ ] **Step 1: Create RepoBadge with pin/unpin and inline repo selector**

```jsx
// src/components/DevToolkit/shared/RepoBadge.jsx
import { useState, useRef, useEffect, useMemo } from 'react'
import { Pin, PinOff, ChevronDown, Search } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'

export function RepoBadge({ repos = [], selectedRepo, isPinned, onSelectRepo, onTogglePin }) {
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    const containerRef = useRef(null)

    useEffect(() => {
        if (!open) return
        const handler = (e) => {
            if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [open])

    const filtered = useMemo(() => {
        if (!query) return repos.slice(0, 30)
        const q = query.toLowerCase()
        return repos.filter(r => r.full_name?.toLowerCase().includes(q)).slice(0, 30)
    }, [repos, query])

    return (
        <div ref={containerRef} className="relative">
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => setOpen(!open)}
                    className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border transition-all ${
                        isPinned
                            ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400 shadow-sm shadow-indigo-500/10'
                            : 'bg-slate-100 dark:bg-slate-800/60 border-slate-200/60 dark:border-slate-700/60 text-slate-600 dark:text-slate-400'
                    }`}
                >
                    {selectedRepo ? (
                        <span className="truncate max-w-[280px]">{selectedRepo.full_name}</span>
                    ) : (
                        <span className="text-slate-400 dark:text-slate-500">Select repo...</span>
                    )}
                    <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                </button>
                {selectedRepo && (
                    <button
                        type="button"
                        onClick={onTogglePin}
                        className={`p-1.5 rounded-lg transition-colors ${
                            isPinned
                                ? 'text-indigo-400 hover:bg-indigo-500/10'
                                : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                        title={isPinned ? 'Unpin repo' : 'Pin repo'}
                        aria-label={isPinned ? 'Unpin repository' : 'Pin repository'}
                    >
                        {isPinned ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
                    </button>
                )}
            </div>

            <AnimatePresence>
                {open && (
                    <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.15 }}
                        className="absolute z-50 mt-1 left-0 w-80 max-h-60 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl"
                    >
                        <div className="sticky top-0 bg-white dark:bg-slate-900 p-2 border-b border-slate-100 dark:border-slate-800">
                            <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                                <Search className="w-3.5 h-3.5 text-slate-400" />
                                <input
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder="Search repos..."
                                    className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
                                    autoFocus
                                />
                            </div>
                        </div>
                        {filtered.length === 0 ? (
                            <div className="px-3 py-4 text-center text-xs text-slate-400">No repos found</div>
                        ) : (
                            filtered.map(repo => (
                                <button
                                    key={repo.id || repo.full_name}
                                    type="button"
                                    onClick={() => { onSelectRepo(repo); setOpen(false); setQuery('') }}
                                    className={`w-full px-3 py-2 text-left text-sm hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition-colors ${
                                        selectedRepo?.id === repo.id ? 'bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300' : 'text-slate-700 dark:text-slate-300'
                                    }`}
                                >
                                    {repo.full_name}
                                </button>
                            ))
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/DevToolkit/shared/RepoBadge.jsx
git commit -m "feat(toolkit): add RepoBadge component with pin/unpin"
```

---

## Task 10: Frontend — SmartContextBar Component

**Files:**
- Create: `src/components/DevToolkit/shared/SmartContextBar.jsx`

- [ ] **Step 1: Create SmartContextBar**

```jsx
// src/components/DevToolkit/shared/SmartContextBar.jsx
import { X, Sparkles, Lightbulb } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

const TYPE_STYLES = {
    feature: { label: 'Feature', color: 'text-emerald-400' },
    bugfix: { label: 'Bugfix', color: 'text-amber-400' },
    refactor: { label: 'Refactor', color: 'text-blue-400' },
    breaking: { label: 'Breaking', color: 'text-red-400' },
    chore: { label: 'Chore', color: 'text-slate-400' },
}

const COMPLEXITY_STYLES = {
    low: 'text-emerald-400',
    medium: 'text-amber-400',
    high: 'text-red-400',
}

export function SmartContextBar({ analysis, diffSummary, loading, onSuggestionClick, onDismissSuggestion }) {
    if (loading) {
        return (
            <div className="px-4 py-2 border-b border-indigo-500/20 bg-indigo-500/5">
                <div className="flex items-center gap-2 text-xs text-slate-400">
                    <Sparkles className="w-3.5 h-3.5 animate-pulse" />
                    Analyzing changes...
                </div>
            </div>
        )
    }

    if (!analysis || !diffSummary) return null

    const typeStyle = TYPE_STYLES[analysis.changeType] || TYPE_STYLES.chore
    const complexityStyle = COMPLEXITY_STYLES[analysis.complexity] || COMPLEXITY_STYLES.medium

    return (
        <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="px-4 py-2.5 border-b border-indigo-500/20 bg-indigo-500/5"
        >
            <div className="flex items-center gap-2 text-xs flex-wrap">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span className={`font-medium ${typeStyle.color}`}>{typeStyle.label}</span>
                <span className="text-slate-500">·</span>
                <span className="text-slate-400">{diffSummary.files_changed} files</span>
                <span className="text-slate-500">·</span>
                <span className="text-emerald-400">+{diffSummary.additions}</span>
                <span className="text-red-400">−{diffSummary.deletions}</span>
                <span className="text-slate-500">·</span>
                <span className={complexityStyle}>{analysis.complexity}</span>
            </div>

            <AnimatePresence>
                {analysis.suggestions?.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="flex items-center gap-2 mt-1.5 flex-wrap"
                    >
                        <Lightbulb className="w-3 h-3 text-amber-400 shrink-0" />
                        {analysis.suggestions.map((s, i) => (
                            <button
                                key={i}
                                type="button"
                                onClick={() => onSuggestionClick?.(s)}
                                className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 border border-indigo-500/20 transition-colors"
                            >
                                {s.message}
                                <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); onDismissSuggestion?.(i) }}
                                    className="ml-0.5 hover:text-white"
                                    aria-label="Dismiss"
                                >
                                    <X className="w-2.5 h-2.5" />
                                </button>
                            </button>
                        ))}
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/DevToolkit/shared/SmartContextBar.jsx
git commit -m "feat(toolkit): add SmartContextBar with AI insights"
```

---

## Task 11: Frontend — Extend useDevToolkit Hook

**Files:**
- Modify: `src/hooks/useDevToolkit.js`

- [ ] **Step 1: Rewrite useDevToolkit with extended state**

Add cross-tab context, auto-draft, panel width, pin state, and context analysis state. Keep all existing functionality intact.

The hook currently returns: `activeTab, setActiveTab, repos, selectedRepo, selectRepo, headBranch, setHeadBranch, baseBranch, setBaseBranch, branches, compareData, compareLoading, fetchCompare, prContext, setPrContext, history, addToHistory`.

Add these new properties to the return:
- `generatedCommit, setGeneratedCommit` — cross-tab: commit message from CommitTab
- `generatedPR, setGeneratedPR` — cross-tab: PR info after creation
- `contextAnalysis, contextAnalysisLoading` — Smart Context Bar data
- `isPinned, setIsPinned` — pin state for repo
- `panelWidth, setPanelWidth` — resizable panel width
- `autoDraftEnabled, setAutoDraftEnabled` — toggle for auto-draft
- `fetchContextAnalysis` — function to call analyze-context endpoint

Add the new state variables and the `fetchContextAnalysis` function. Panel width and autoDraft persist to sessionStorage.

Modify `selectRepo` to also set `isPinned` based on context.

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useDevToolkit.js
git commit -m "feat(hooks): extend useDevToolkit with cross-tab context and panel state"
```

---

## Task 12: Frontend — DevToolkitPanel Component

**Files:**
- Create: `src/components/DevToolkit/DevToolkitPanel.jsx`

- [ ] **Step 1: Create the main panel container**

This replaces `DevToolkitModal.jsx`. It renders a fixed right-side panel with:
- Backdrop + slide-in animation (reuse SidePanel patterns)
- Gradient header with title, RepoBadge, close button
- Tab bar (Commits | Pull Request | Review) with animated underline
- SmartContextBar below tabs
- Tab content area with scroll
- Drag handle for resizing
- Focus trap and body scroll lock

Key imports: `useFocusTrap`, `useBodyScrollLock` from existing hooks, `RepoBadge`, `SmartContextBar`, tab components, `useDevToolkit`.

The component receives: `isOpen, onClose, modalData, repos, onStartReview`.

Panel width is stored in `toolkit.panelWidth`, updated via drag handle mouse events.

Use `useMemo` for tab content rendering (same pattern as current DevToolkitModal).

The tab bar uses Framer Motion `layoutId="dev-toolkit-panel-tabs"` for animated underline.

- [ ] **Step 2: Commit**

```bash
git add src/components/DevToolkit/DevToolkitPanel.jsx
git commit -m "feat(toolkit): add DevToolkitPanel side panel container"
```

---

## Task 13: Frontend — Update CommitTab for Streaming & RefinementZone

**Files:**
- Modify: `src/components/DevToolkit/CommitTab/CommitTab.jsx`

- [ ] **Step 1: Replace OutputSection with StreamingOutput and add RefinementZone**

Changes:
1. Import `useStreaming` instead of sync fetch for generation
2. Import `StreamingOutput` instead of `OutputSection`
3. Import `RefinementZone` instead of `RefinementChips`
4. Add version history state (`versions` array)
5. Modify `handleGenerate` to use `startStream('/api/ai/generate-commit', body)` instead of `fetch`
6. When streaming completes (`result`), extract the message and add to history
7. Modify `handleRefine` to also use streaming for chip refinements
8. Add `handleChatRefine` for free-text refinement via `/api/ai/chat-refine`
9. Track versions: each generation/refinement pushes `{ content, instruction, time }` to versions array
10. Use `toolkit.setGeneratedCommit` to share commit message cross-tab
11. Replace `<OutputSection>` with `<StreamingOutput>` passing streaming props
12. Replace `<RefinementChips>` with `<RefinementZone>` passing chips, chat handler, versions
13. Remove the standalone `RepoSelector` since it's now in the panel header

- [ ] **Step 2: Commit**

```bash
git add src/components/DevToolkit/CommitTab/CommitTab.jsx
git commit -m "feat(toolkit): update CommitTab with streaming and RefinementZone"
```

---

## Task 14: Frontend — Update PRTab for Streaming & Cross-Tab Context

**Files:**
- Modify: `src/components/DevToolkit/PRTab/PRTab.jsx`

- [ ] **Step 1: Update PRTab**

Changes:
1. Import `useStreaming` for streaming generation
2. Import `RefinementZone` for the bottom refinement area
3. Use `toolkit.generatedCommit` to show "Using commit context" badge
4. Pass `generatedCommit` as additional context in the generate-pr request body
5. Use streaming for PR generation — show raw streaming text while generating, then render structured PRSections when `result` arrives
6. Add PR context info card showing: existing PR badge, commit context badge, template badge
7. Add `handleChatRefine` for free-text refinement
8. After PR creation, call `toolkit.setGeneratedPR({ number, url, title })`
9. Remove standalone `RepoSelector` (now in panel header)
10. Use version history for section refinements

- [ ] **Step 2: Commit**

```bash
git add src/components/DevToolkit/PRTab/PRTab.jsx
git commit -m "feat(toolkit): update PRTab with streaming and cross-tab context"
```

---

## Task 15: Frontend — Update ReviewTab with Streaming & Q&A

**Files:**
- Modify: `src/components/DevToolkit/ReviewTab/ReviewTab.jsx`

- [ ] **Step 1: Update ReviewTab**

Changes:
1. Import `useStreaming` for streaming summary
2. Import `ChatInput` for conversational Q&A
3. Use streaming for review summary generation
4. Add Q&A section: `ChatInput` below the summary with "Ask about this PR..." placeholder
5. Q&A uses `/api/ai/chat-refine` with `content_type: 'review_qa'`
6. Maintain Q&A conversation history (max 5 exchanges) in local state
7. Display Q&A responses in a scrollable list below the input
8. Remove standalone `RepoSelector` (now in panel header)
9. If `toolkit.generatedPR` exists, pre-highlight that PR in the list

- [ ] **Step 2: Commit**

```bash
git add src/components/DevToolkit/ReviewTab/ReviewTab.jsx
git commit -m "feat(toolkit): update ReviewTab with streaming and Q&A"
```

---

## Task 16: Frontend — Wire DevToolkitPanel into App.jsx

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Replace DevToolkitModal with DevToolkitPanel in App.jsx**

Changes:
1. Update the lazy import (line 45):
   ```javascript
   const DevToolkitPanel = lazy(() => import('./components/DevToolkit/DevToolkitPanel').then(m => ({ default: m.DevToolkitPanel })))
   ```
2. Replace the `<DevToolkitModal>` render block (lines 938-950) with:
   ```jsx
   <Suspense fallback={null}>
     <DevToolkitPanel
       isOpen={modalStates.showDevToolkit}
       onClose={() => closeModal('showDevToolkit')}
       modalData={getModalData('showDevToolkit')}
       repos={repos}
       onStartReview={(pr) => {
         closeModal('showDevToolkit')
         setReviewingPR(pr)
         setActiveView('pr-review')
       }}
     />
   </Suspense>
   ```
3. The props are identical — `DevToolkitPanel` uses the same interface as `DevToolkitModal` did.

- [ ] **Step 2: Commit**

```bash
git add src/App.jsx
git commit -m "feat(app): swap DevToolkitModal for DevToolkitPanel"
```

---

## Task 17: Cleanup & Final Polish

**Files:**
- Delete: `src/components/DevToolkit/DevToolkitModal.jsx`

- [ ] **Step 1: Delete the old DevToolkitModal**

The file is no longer imported anywhere. Safe to delete.

```bash
rm -f "src/components/DevToolkit/DevToolkitModal.jsx"
```

- [ ] **Step 2: Verify no remaining imports of DevToolkitModal**

```bash
grep -r "DevToolkitModal" src/
```

Should return zero results. If any remain, update them.

- [ ] **Step 3: Verify the app builds**

```bash
npx vite build
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(toolkit): remove deprecated DevToolkitModal"
```

---

## Task 18: Visual Testing & Dev Server Validation

- [ ] **Step 1: Start the dev server and validate**

```bash
npm run dev
```

- [ ] **Step 2: Test all scenarios**

1. Open Dev Toolkit from header → should open as side panel (standalone mode)
2. Open from RepoDetail → should open pinned to that repo
3. Switch between tabs → animated underline, content transitions
4. Commits tab: select branches, generate commit with streaming
5. PR tab: generate PR description with streaming, see cross-tab context badge
6. Review tab: select PR, see streaming summary, use Q&A chat
7. Refinement: use chips and free-text chat input
8. Pin/unpin repo badge
9. Resize panel via drag handle
10. Close via X, backdrop click, Escape key
11. Mobile: should render as bottom sheet

- [ ] **Step 3: Fix any visual or functional issues found**

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "fix(toolkit): polish and visual adjustments"
```
