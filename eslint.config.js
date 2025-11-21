import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettierConfig from 'eslint-config-prettier';
import sveltePlugin from 'eslint-plugin-svelte';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['**/*.{js,ts,mjs,cjs}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module'
      },
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': 'error'
    }
  },
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        parser: tsParser,
        extraFileExtensions: ['.svelte']
      }
    },
    plugins: {
      svelte: sveltePlugin
    },
    rules: {
      ...sveltePlugin.configs.recommended.rules
    }
  },
  prettierConfig,
  {
    ignores: ['**/dist/**', '**/build/**', '**/node_modules/**', '**/.svelte-kit/**', '**/bin/**', '**/obj/**']
  }
];
