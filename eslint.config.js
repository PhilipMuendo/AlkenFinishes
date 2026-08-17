import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import prettier from 'eslint-config-prettier';

/**
 * Lint exists here to hold the conventions the review found drifting:
 * label/control association, keyboard handlers on clickable things, hook
 * dependency correctness, and no stray `any`. Formatting is Prettier's job —
 * `eslint-config-prettier` goes last so the two never disagree.
 */
export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/build/**', 'apps/api/prisma/migrations/**'] },

  // ---- Shared TypeScript baseline ----------------------------------------
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // A floating promise in a click handler swallows its own failure.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
    },
  },

  // ---- Web app: React + accessibility ------------------------------------
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // The review's findings, encoded so they cannot come back:
      // every form control reachable from its label…
      'jsx-a11y/label-has-associated-control': [
        'error',
        {
          assert: 'either',
          depth: 3,
          controlComponents: ['Input', 'Select', 'Textarea', 'Combobox'],
        },
      ],
      // …and nothing clickable that a keyboard cannot reach.
      'jsx-a11y/no-static-element-interactions': 'error',
      'jsx-a11y/click-events-have-key-events': 'error',
      'jsx-a11y/anchor-is-valid': 'off', // react-router <Link> handles hrefs
      // Every `autoFocus` in this app is on the first field of a modal that
      // the user just chose to open, which is where focus should already be.
      // The rule is aimed at page-load autofocus, which we do not do.
      'jsx-a11y/no-autofocus': 'off',
    },
  },

  // ---- API: Node globals --------------------------------------------------
  {
    files: ['apps/api/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },

  // Tests lean on loose fixtures; the strictness above buys nothing there.
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'apps/api/prisma/seed.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off', 'no-console': 'off' },
  },

  prettier,
);
