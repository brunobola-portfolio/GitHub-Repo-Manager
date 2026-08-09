// Applies the saved (or system) theme to <html> before React renders, so a
// dark-mode user never sees a white flash.
//
// This lives in public/ as an external file rather than inline in index.html
// because the production CSP is `script-src 'self'` with no nonce and no hash
// (server/index.js, helmet). An inline script is blocked there — the app still
// boots, but every dark-mode page load flashes white and the console fills
// with CSP violations. Vite copies public/ into dist/ verbatim, and Express
// serves unhashed dist files with Cache-Control: no-cache, so this stays in
// step with the app across deploys.
//
// Keep the storage key in sync with STORAGE_KEY in src/hooks/useTheme.jsx.
(function () {
    var saved = localStorage.getItem('github-repo-manager-theme');
    var isDark = saved === 'dark' || (saved !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (isDark) document.documentElement.classList.add('dark');
})();
