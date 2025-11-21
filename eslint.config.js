import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import ts from 'typescript-eslint';

export default [
  {
    ignores: [
      'node_modules',
      'dist',
      'build',
      '.svelte-kit',
      'coverage',
      'packages/*/dist',
      'packages/*/.svelte-kit',
      'examples/*/dist',
      'examples/*/.svelte-kit',
      'bin',
      'obj',
      '**/*.svelte',
      '**/eslint.config.*',
      '**/Generated/**',
      'packages/schemas/generate-*.js',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  prettier,
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        URL: 'readonly',
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        require: 'readonly',
      },
    },
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];
