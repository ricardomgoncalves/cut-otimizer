// @ts-check
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Browser globals the pure core must never touch. Typecheck also catches most
// of these (tsconfig.core.json has no DOM lib); this gives a clear message.
const browserOnlyGlobals = [
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'location',
  'history',
  'alert',
  'fetch',
].map((name) => ({
  name,
  message: 'src/core is pure: no DOM or browser APIs. Pass what you need in from the shell.',
}));

export default defineConfig([
  globalIgnores(['dist', 'playwright-report', 'test-results', 'node_modules']),

  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.strict, tseslint.configs.stylistic],
  },

  // Shell: React + browser.
  {
    files: ['src/shell/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest'], reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
  },

  // Core: pure TypeScript, no React, no DOM, no shell imports.
  {
    files: ['src/core/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(react|react-dom|react/.*|react-dom/.*|dexie|pdf-lib)$',
              message: 'src/core is pure: no React, DOM or browser-storage libraries.',
            },
            {
              regex: '(^|/)shell(/|$)',
              message: 'src/core must not depend on the shell.',
            },
          ],
        },
      ],
      'no-restricted-globals': ['error', ...browserOnlyGlobals],
    },
  },
  // Node-side files: configs, Playwright specs, repo-level tests.
  {
    files: ['*.{js,ts}', 'e2e/**/*.ts', 'tests/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
]);
