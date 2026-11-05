import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '.npm-cache/**',
      '.claude/**',
      '.dev-data/**',
      '.tsbuild/**',
      'build/**',
      'release/**',
      'python/**',
      'test-results/**',
      'tests/fixtures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // The renderer talks to core only through the typed RPC client. Types may be imported, values may not.
    files: ['packages/ui/src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'electron', message: 'The renderer has no Electron access.' },
            { name: 'better-sqlite3', message: 'The renderer has no database access.' },
            {
              name: '@mossnote/core',
              allowTypeImports: true,
              message: 'Import types only; call core through the RPC client.',
            },
          ],
          patterns: [
            { group: ['node:*'], message: 'The renderer has no Node access.' },
            {
              group: ['@mossnote/core/*'],
              allowTypeImports: true,
              message: 'Import types only; call core through the RPC client.',
            },
          ],
        },
      ],
    },
  },
  {
    // CS-11: core is shell-independent so another shell or a mobile client can reuse it.
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['electron', 'electron/*'],
              message: 'core must not import Electron (CS-11).',
            },
            {
              group: ['react', 'react-dom', 'react/*', 'react-dom/*'],
              message: 'core must not import UI code (CS-11).',
            },
          ],
        },
      ],
    },
  },
);
