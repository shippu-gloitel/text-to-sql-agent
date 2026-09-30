import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import pluginReact from 'eslint-plugin-react';
import { defineConfig, globalIgnores } from 'eslint/config';
// import nextVitals from 'eslint-config-next/core-web-vitals';
// import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

export default defineConfig([
  // ...nextVitals,
  // ...nextTs,
  js.configs.recommended,
  tseslint.configs.recommended,
  pluginReact.configs.flat.recommended,
  prettierConfig,

  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    plugins: { js, prettier },
    extends: ['js/recommended'],

    languageOptions: {
      globals: globals.browser,
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module', project: './tsconfig.json' },
    },
    settings: {
      node: { version: 'detect' },
      react: { version: '19.3' },
    },

    rules: {
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
      complexity: ['warn', { max: 20 }],
      semi: ['error', 'always'],
      'no-duplicate-imports': 'error',
      'no-console': 'error',
      'no-debugger': 'error',
      'no-undef': 'error',
      'no-var': 'warn',
      'no-empty-function': 'warn',
      'no-useless-escape': 'off',
      'no-unused-vars': 'error',
      'prefer-const': 'warn',
      'array-bracket-spacing': 'warn',
      'object-curly-spacing': ['warn', 'always'],
      // react and nextjs
      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-react': 'off',
      'react-hooks/exhaustive-deps': 'off',
    },
  },

  {
    files: ['**/*.{ts,mts,cts,tsx}'],
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
    },
  },

  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'node_modules/**',
    'public/**',
    '.agents/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // agents
    '.agents',
    'skills-lock.json',
    '.langgraph_api',
    // others
    'postcss.config.{mjs,cjs,js,ts}',
    '**/backup/*',
    '**/tsconfig-paths-register.d.ts',
    '**/env.d.ts',
    '**/global.d.ts',
    '.vscode/*',
    'eslint.config.{mjs,cjs,ts,js}',
    '**/node_modules',
    '**/package-lock.json',
    '**/yarn.lock',
    '**/pnpm-lock.yaml',
    '**/bun.lockb',
    '**/.next',
    '**/.husky',
    '**/commitlint.config.{js,ts,mjs,cts}',
    '**/logs',
    '**/build',
    '**/dist',
    '*.tsbuildinfo',
    '**/tsconfig.tsbuildinfo',
    '**/*.log',
    '**/npm-debug.log*',
    '**/yarn-debug.log*',
    '**/yarn-error.log*',
    '**/pnpm-debug.log*',
    '**/lerna-debug.log*',
    '**/*.spec.ts',
    '**/*.test.ts',
    '__tests__',
    // PWA
    'sw.js',
    'sw.js.map',
    'workbox-*.js',
    'workbox-*.js.map',
    '**/public/sw.js',
    '**/public/workbox-*.js',
    '**/public/worker-*.js',
    '**/public/sw.js.map',
    '**/public/workbox-*.js.map',
    '**/public/worker-*.js.map',
    '**/test.{js,ts,mjs}',
    '**/op.{js,ts,mjs}',
  ]),
]);
