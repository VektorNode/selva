import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

/** @type {import('eslint').Linter.Config[]} */
export const config = [
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	prettier,
	...svelte.configs.prettier,
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
		// `no-undef` can't see TypeScript's type-only globals — `EventListener`,
		// `RequestInit`, `NodeListOf` and friends live in lib.dom.d.ts, not in any
		// runtime globals list — so it reports them as undefined. tsc already fails
		// on genuinely undefined identifiers, making the rule redundant here.
		files: ['**/*.ts', '**/*.tsx', '**/*.svelte'],
		rules: {
			'no-undef': 'off'
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
 * What the typed pass covers unless a package overrides it: async-heavy code
 * where a dropped promise actually costs something. Widen per package via
 * `createConfig`'s `typedFiles`, not here — every added glob is paid in full
 * TypeScript program construction.
 */
const DEFAULT_TYPED_FILES = ['src/lib/server/**/*.ts', 'src/routes/**/*.ts', 'src/**/*.server.ts'];

/**
 * Project-specific ESLint config. Untyped unless asked otherwise.
 *
 * The type-aware rules need `projectService`, which builds a full TypeScript
 * program for every file it matches. On this repo that is the difference between
 * a 19s and a 132s run, so they're opt-in — a package turns them on from its
 * `eslint.typed.config.js`, run by `pnpm lint:types` — and scoped to `typedFiles`
 * rather than every TypeScript file in the package.
 *
 * @param {string} tsconfigRootDir - Project root, usually `__dirname`.
 * @param {{ typed?: boolean, typedFiles?: string[] }} [options] `typed` turns the
 *   typed pass on; `typedFiles` overrides its scope.
 * @returns {import('eslint').Linter.Config[]}
 */
export const createConfig = (tsconfigRootDir, options = {}) => {
	const { typed = false, typedFiles = DEFAULT_TYPED_FILES } = options;

	if (!typed) return [...config];

	return [
		...config,
		{
			// `tsconfigRootDir` is pinned so the project service resolves each file's
			// nearest tsconfig from this root deterministically instead of
			// auto-detecting multiple candidate roots.
			files: typedFiles,
			languageOptions: {
				parserOptions: {
					projectService: true,
					tsconfigRootDir,
					extraFileExtensions: ['.svelte']
				}
			},
			// The two type-aware rules that catch real bugs (dropped awaits, promises
			// passed where sync callbacks are expected), cherry-picked instead of all
			// of `recommendedTypeChecked` — the rest is dominated by `no-unsafe-*`
			// noise cascading from existing `any`s.
			rules: {
				'@typescript-eslint/no-floating-promises': 'warn',
				'@typescript-eslint/no-misused-promises': 'warn'
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
};

export default config;
