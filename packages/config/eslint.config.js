import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

/** @type {import('eslint').Linter.Config[]} */
export const config = [
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs['flat/recommended'],
	prettier,
	...svelte.configs['flat/prettier'],
	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
				// vite-injected build-time constants used by the selva app's
				// admin shell (defined in vite.config.ts via `define:`).
				__GIT_HASH__: 'readonly',
				__GIT_SHORT_HASH__: 'readonly',
				__GIT_MESSAGE__: 'readonly',
				__GIT_DATE__: 'readonly'
			}
		}
	},
	{
		files: ['**/*.svelte'],
		languageOptions: {
			parserOptions: {
				parser: ts.parser,
				extraFileExtensions: ['.svelte']
			}
		}
	},
	{
		files: ['**/*.svelte.ts'],
		languageOptions: {
			parser: ts.parser
		}
	},
	{
		ignores: [
			'build/',
			'.svelte-kit/',
			'dist/',
			'node_modules/',
			// Root config files live outside every tsconfig `include`, so the
			// typed `projectService` (eslint 10) can't parse them and errors.
			// They don't need application linting. Ignored here so per-package
			// configs (which call createConfig from their own dir) inherit it.
			'*.config.ts',
			'*.config.js',
			'*.config.mjs'
		]
	},
	{
		rules: {
			'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
			],
			'@typescript-eslint/no-explicit-any': 'warn',
			'svelte/no-at-html-tags': 'warn',
			'svelte/no-navigation-without-resolve': 'warn',
			// New eslint 10 recommended rules. Demoted to warn: both fire on
			// idiomatic code the repo relies on — `no-useless-assignment` flags
			// try/catch fallback initializers and Svelte `$bindable(null)` prop
			// defaults; `preserve-caught-error` flags rethrows that already pass a
			// `cause`. Kept as signal, not a CI blocker.
			'no-useless-assignment': 'warn',
			'preserve-caught-error': 'warn'
		}
	}
];

/**
 * Create a project-specific ESLint config
 * @param {string} tsconfigRootDir - The root directory of the project (usually __dirname)
 * @returns {import('eslint').Linter.Config[]}
 */
export const createConfig = (tsconfigRootDir) => [
	...config,
	{
		// Typed linting for TS/Svelte only. `tsconfigRootDir` is pinned so the
		// project service resolves each file's nearest tsconfig from this root
		// deterministically instead of auto-detecting multiple candidate roots.
		files: ['**/*.ts', '**/*.tsx', '**/*.svelte'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir,
				extraFileExtensions: ['.svelte']
			}
		}
	},
	{
		// Re-assert the untyped parser for JS after the typed block, since the
		// base `ts.configs.recommended` (in `config`) matches all files.
		files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
		languageOptions: {
			parserOptions: {
				projectService: false,
				project: null,
				program: null
			}
		}
	}
];

export default config;
