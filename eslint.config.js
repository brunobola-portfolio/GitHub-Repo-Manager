import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import reactPlugin from 'eslint-plugin-react'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import { defineConfig, globalIgnores } from 'eslint/config'

// Shared no-restricted-syntax entries for the layout anti-drift gate — used in
// two config blocks below (they cannot be one block: see the comment there).
const layoutAntiDriftRules = [
  {
    selector: String.raw`Literal[value=/\bmin-\[\d+px\]/]`,
    message: 'Use the named breakpoints nav:/wide:/ultra: (src/index.css @theme) instead of raw min-[Npx] variants.',
  },
  {
    selector: String.raw`TemplateElement[value.raw=/\bmin-\[\d+px\]/]`,
    message: 'Use the named breakpoints nav:/wide:/ultra: (src/index.css @theme) instead of raw min-[Npx] variants.',
  },
  {
    // Shell-scale caps only (1900-2999px) — small max-w-[Npx] values on
    // menus/popovers are legitimate component sizing.
    selector: String.raw`Literal[value=/\bmax-w-\[(19|2\d)\d{2}px\]/]`,
    message: 'Use max-w-[var(--layout-max-w)] (src/index.css) for shell-scale caps so ultrawide sizing stays in one token.',
  },
  {
    selector: String.raw`TemplateElement[value.raw=/\bmax-w-\[(19|2\d)\d{2}px\]/]`,
    message: 'Use max-w-[var(--layout-max-w)] (src/index.css) for shell-scale caps so ultrawide sizing stays in one token.',
  },
  // duration-300 was fully migrated to the motion tokens (2026-07-06); the
  // deliberate scale is duration-200 (Tailwind) for snappy cases plus the two
  // tokens below — a literal 300 means someone bypassed that decision.
  {
    selector: String.raw`Literal[value=/\bduration-300\b/]`,
    message: 'Use the motion tokens: duration-[var(--ds-duration)] (200ms, hover/micro) or duration-[var(--ds-duration-slow)] (320ms, layout/lift).',
  },
  {
    selector: String.raw`TemplateElement[value.raw=/\bduration-300\b/]`,
    message: 'Use the motion tokens: duration-[var(--ds-duration)] (200ms, hover/micro) or duration-[var(--ds-duration-slow)] (320ms, layout/lift).',
  },
]

export default defineConfig([
  globalIgnores(['dist', '**/dist/**', '.claude/worktrees/**', '.dev/**', 'coverage/**']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    plugins: {
      'jsx-a11y': jsxA11y,
      react: reactPlugin,
    },
    settings: { react: { version: 'detect' } },
    languageOptions: {
      ecmaVersion: 2020,
	      globals: {
	        ...globals.browser,
	        ...globals.node,
	      },
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['warn', {
        varsIgnorePattern: '^_|^[A-Z]|^motion$',
        argsIgnorePattern: '^_|^[A-Z]',
        caughtErrorsIgnorePattern: '^_|e$|error$|err$',
        destructuredArrayIgnorePattern: '^_',
        ignoreRestSiblings: true
      }],
      // Catch <Component/> used without being imported/defined — plain no-undef
      // can't see JSX identifiers, which let two real "ReferenceError: X is not
      // defined" render crashes ship invisibly (TeamDetails/MyReviewsTab Spinner).
      'react/jsx-no-undef': 'error',
      'react-hooks/exhaustive-deps': 'error',
      // react-hooks 7.1+ added stricter rules that flag pre-existing patterns
      // across the codebase (boundary state resets, async loading flags,
      // ref-during-render, etc.). Same approach as jsx-a11y above — surface
      // as warnings so CI stays green, but keep them visible for a dedicated
      // cleanup pass.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/use-memo': 'warn',
      'react-hooks/incompatible-library': 'warn',
      'react-hooks/purity': 'warn',
      // jsx-a11y rules are surfaced as warnings during gradual adoption — new
      // code should pass them, but the existing codebase has 80+ violations
      // that need a dedicated cleanup pass before they can be promoted to
      // errors. Track in docs/plans/ as a follow-up.
      'jsx-a11y/alt-text': 'warn',
      'jsx-a11y/anchor-has-content': 'warn',
      'jsx-a11y/anchor-is-valid': 'warn',
      'jsx-a11y/aria-props': 'error', // strict — typos here are silent failures
      'jsx-a11y/aria-proptypes': 'error',
      'jsx-a11y/aria-role': 'error',
      'jsx-a11y/aria-unsupported-elements': 'error',
      'jsx-a11y/click-events-have-key-events': 'warn',
      'jsx-a11y/heading-has-content': 'warn',
      'jsx-a11y/iframe-has-title': 'warn',
      'jsx-a11y/img-redundant-alt': 'warn',
      'jsx-a11y/interactive-supports-focus': 'warn',
      'jsx-a11y/label-has-associated-control': 'warn',
      'jsx-a11y/no-noninteractive-element-interactions': 'warn',
      'jsx-a11y/no-noninteractive-tabindex': 'warn',
      'jsx-a11y/no-redundant-roles': 'warn',
      'jsx-a11y/no-static-element-interactions': 'warn',
      'jsx-a11y/role-has-required-aria-props': 'error',
      'jsx-a11y/role-supports-aria-props': 'error',
    },
  },
  {
    // Surfacing err.stack (or any .stack) inside UI components leaks
    // implementation detail to users. The formatUserError() helper in
    // src/utils/errors.js is the supported way to convert exceptions
    // into a user-facing toast/banner.
    files: ['src/components/**/*.{js,jsx}', 'src/hooks/**/*.{js,jsx}', 'src/utils/**/*.{js,jsx}'],
    rules: {
      'no-restricted-syntax': ['error',
        {
          selector: "MemberExpression[property.name='stack']",
          message: 'Do not surface .stack in UI. Use formatUserError(err) from src/utils/errors.js instead.',
        },
        {
          selector: "JSXAttribute[name.name='whileHover'] ObjectExpression > Property[key.name='rotate']",
          message: 'Theme spec: no rotate on hover. See docs/specs/2026-05-14-premium-non-llm-theme-design.md anti-patterns.',
        },
        {
          selector: "JSXAttribute[name.name='whileHover'] ObjectExpression > Property[key.name='scale']",
          message: 'Theme spec: no scale on hover (cards-as-button exception is rare — discuss in review).',
        },
        {
          selector: "Literal[value=/\\bfont-(extrabold|black)\\b/]",
          message: 'Theme spec: max font weight on UI text is font-semibold (600). font-extrabold and font-black are forbidden.',
        },
        {
          selector: "Literal[value=/\\bbackdrop-blur-(xl|2xl|3xl)\\b/]",
          message: 'Theme spec: max blur is backdrop-blur-md.',
        },
        {
          selector: "Literal[value=/\\bds-(gradient-text|card-shimmer|btn-shimmer|border-glow|hover-glow|animate-float|pulse-glow|glass(-strong)?)\\b/]",
          message: 'Theme spec: this ds-* class is in the kill list.',
        },
        // Layout anti-drift gate (spec 2026-06-25 workstream 3). The shell went
        // through a token migration — named breakpoints (`nav:`/`wide:`/`ultra:`
        // from the @theme block in src/index.css) and `--layout-px`/
        // `--layout-max-w` vars — so raw pixel breakpoints must not creep back.
        ...layoutAntiDriftRules,
      ],
    },
  },
  {
    // Same layout gate for the src files OUTSIDE the block above (App.jsx,
    // actions, contexts, …). Flat-config `rules` REPLACE rather than merge for
    // overlapping files, so this block must exclude the dirs already covered —
    // otherwise it would silently drop the theme-spec rules there.
    files: ['src/**/*.{js,jsx}'],
    ignores: ['src/components/**', 'src/hooks/**', 'src/utils/**'],
    rules: {
      'no-restricted-syntax': ['error', ...layoutAntiDriftRules],
    },
  },
])
