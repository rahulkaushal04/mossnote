import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

// ---------------------------------------------------------------------------
// Import boundaries (spec section 14). `no-restricted-imports` replaces rather
// than merges per file, so every scope below spells out its complete rule set.
// ---------------------------------------------------------------------------

const SQLITE_PATHS = [
  { name: 'better-sqlite3', message: 'Only src/server/db and src/server/services touch SQLite.' },
];
const SQLITE_PATTERNS = [
  {
    group: ['drizzle-orm', 'drizzle-orm/*'],
    message: 'Only src/server/db and src/server/services touch SQLite.',
  },
];
const NODE_IN_SHARED = [{ group: ['node:*'], message: 'src/shared must not use Node APIs.' }];
const NETWORK_MODULES = [
  'node:http',
  'node:https',
  'node:net',
  'node:http2',
  'node:dgram',
  'node:tls',
];

const noWebFromServer = [
  { group: ['@web/*', '**/web/**'], message: 'server must not import from web.' },
  {
    group: ['react', 'react-dom', 'react-router', '@radix-ui/*'],
    message: 'server must not use UI libraries.',
  },
];

// Calls like sqlite.prepare(`... ${x}`) or .exec('a' + b) are string-built SQL.
const NO_STRING_SQL = [
  {
    selector:
      'CallExpression[callee.property.name=/^(prepare|exec|pragma)$/] > TemplateLiteral[expressions.length>0]',
    message: 'Do not build SQL from strings. Use bound parameters or the drizzle sql tag.',
  },
  {
    selector: 'CallExpression[callee.property.name=/^(prepare|exec|pragma)$/] > BinaryExpression',
    message: 'Do not build SQL from strings. Use bound parameters or the drizzle sql tag.',
  },
];

const NO_DANGEROUS_HTML = [
  {
    selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
    message: 'dangerouslySetInnerHTML is banned (spec section 25).',
  },
  {
    selector: "Property[key.name='dangerouslySetInnerHTML']",
    message: 'dangerouslySetInnerHTML is banned (spec section 25).',
  },
];

const NO_PROCESS_ENV = {
  selector: "MemberExpression[object.name='process'][property.name='env']",
  message: 'Only src/server/config.ts reads the environment.',
};

const NO_FETCH_GLOBALS = [
  { name: 'fetch', message: 'Only src/web/lib/api.ts performs HTTP requests.' },
  { name: 'XMLHttpRequest', message: 'Only src/web/lib/api.ts performs HTTP requests.' },
  { name: 'WebSocket', message: 'No network access other than through src/web/lib/api.ts.' },
  { name: 'EventSource', message: 'No network access other than through src/web/lib/api.ts.' },
];

export default tseslint.config(
  {
    ignores: [
      'dist',
      '.tsbuild',
      '.dev-data',
      'node_modules',
      'drizzle',
      'playwright-report',
      'test-results',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: false },
    },
  },

  // --- shared: no Node, no DOM, nothing from server or web ---------------
  {
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: SQLITE_PATHS,
          patterns: [
            ...SQLITE_PATTERNS,
            ...NODE_IN_SHARED,
            {
              group: ['@server/*', '@web/*', '**/server/**', '**/web/**'],
              message: 'shared imports nothing from server or web.',
            },
            {
              group: ['react', 'react-dom', 'react-router', 'hono', 'hono/*'],
              message: 'shared stays framework-free.',
            },
          ],
        },
      ],
      'no-restricted-globals': ['error', ...NO_FETCH_GLOBALS],
    },
  },

  // --- server (everything except db/services) ----------------------------
  {
    files: ['src/server/**/*.ts'],
    ignores: ['src/server/db/**', 'src/server/services/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...SQLITE_PATHS,
            ...NETWORK_MODULES.map((name) => ({
              name,
              message: 'The server makes no outbound network calls.',
            })),
          ],
          patterns: [...SQLITE_PATTERNS, ...noWebFromServer],
        },
      ],
      'no-restricted-globals': ['error', ...NO_FETCH_GLOBALS],
      'no-restricted-syntax': ['error', NO_PROCESS_ENV],
    },
  },
  // --- server/db and server/services: may touch SQLite -------------------
  {
    files: ['src/server/db/**/*.ts', 'src/server/services/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: NETWORK_MODULES.map((name) => ({
            name,
            message: 'The server makes no outbound network calls.',
          })),
          patterns: noWebFromServer,
        },
      ],
      'no-restricted-globals': ['error', ...NO_FETCH_GLOBALS],
      'no-restricted-syntax': ['error', NO_PROCESS_ENV, ...NO_STRING_SQL],
    },
  },
  // config.ts is the only file that reads the environment.
  {
    files: ['src/server/config.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  // app.ts builds the Hono app only: no listen, no serve, no environment.
  {
    files: ['src/server/app.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...SQLITE_PATHS,
            {
              name: '@hono/node-server',
              message: 'app.ts never calls listen. Serving lives in index.ts.',
            },
            ...NETWORK_MODULES.map((name) => ({
              name,
              message: 'The server makes no outbound network calls.',
            })),
          ],
          patterns: [...SQLITE_PATTERNS, ...noWebFromServer],
        },
      ],
      'no-restricted-syntax': [
        'error',
        NO_PROCESS_ENV,
        {
          selector: "CallExpression[callee.property.name='listen']",
          message: 'app.ts never calls listen.',
        },
      ],
    },
  },

  // --- web ---------------------------------------------------------------
  {
    files: ['src/web/**/*.{ts,tsx}'],
    ...jsxA11y.flatConfigs.strict,
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    languageOptions: {
      globals: globals.browser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      ...jsxA11y.flatConfigs.strict.rules,
      ...reactHooks.configs.recommended.rules,
      'no-restricted-imports': [
        'error',
        {
          paths: [...SQLITE_PATHS],
          patterns: [
            ...SQLITE_PATTERNS,
            ...NODE_IN_SHARED,
            {
              group: ['@server/*', '!@server/app', '**/server/**'],
              message: 'web may only import the AppType type from @server/app.',
            },
            {
              group: ['@server/app'],
              allowTypeImports: true,
              message: 'web may only type-import from @server/app.',
            },
          ],
        },
      ],
      'no-restricted-globals': ['error', ...NO_FETCH_GLOBALS],
      'no-restricted-syntax': ['error', ...NO_DANGEROUS_HTML],
    },
  },
  // Static scripts served as is (theme-init.js) run in the browser.
  {
    files: ['src/web/public/**/*.js'],
    languageOptions: { globals: globals.browser, sourceType: 'script' },
  },
  // Map geometry indexes into small arrays it has just built (corners, points of a stroke). The
  // two rules about `as` and `!` contradict each other for indexed access, so `!` is allowed here.
  {
    files: ['src/web/features/maps/**/*.{ts,tsx}'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },

  // The one module allowed to talk HTTP.
  {
    files: ['src/web/lib/api.ts'],
    rules: { 'no-restricted-globals': 'off' },
  },

  // --- tests, scripts and config files -----------------------------------
  {
    files: ['**/*.test.{ts,tsx}', 'tests/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      'no-restricted-globals': 'off',
      'no-restricted-syntax': 'off',
      'no-restricted-imports': 'off',
      // Tests index into known fixtures; a failed lookup fails the test anyway.
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
