export function safeJsonParse(json, fallback = null) {
    if (json == null) return fallback;
    try { return JSON.parse(json); }
    catch { return fallback; }
}
