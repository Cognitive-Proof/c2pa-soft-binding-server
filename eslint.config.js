// @ts-check
const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const eslintConfigPrettier = require('eslint-config-prettier');
const globals = require('globals');

module.exports = tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'data/**', 'aiContext/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      // Plugins are loaded dynamically by package name at runtime
      // (createServer's storage/auth/logger/rate-limit plugin resolution).
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // CommonJS config files (root and per-plugin jest/eslint configs)
    files: ['**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },
  eslintConfigPrettier,
);
