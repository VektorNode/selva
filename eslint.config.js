import sharedConfig from './packages/config/eslint.config.js';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default [
  ...sharedConfig,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
  },
  {
    ignores: [
      'node_modules',
      'dist',
      'build',
      '.svelte-kit',
      'coverage',
      'packages/*/dist',
      'packages/*/build',
      'packages/*/.svelte-kit',
      'examples/*/dist',
      'examples/*/.svelte-kit',
      'bin',
      'obj',
      '**/Generated/**',
      'packages/schemas/generate-*.js',
      '**/*.d.ts',
    ],
  },
  {
    files: ['scripts/**/*.{js,ts}'],
    rules: {
      'no-console': 'off',
    },
  },
];
