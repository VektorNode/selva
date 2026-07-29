import { createConfig } from './packages/config/eslint.config.js';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default [
	...createConfig(__dirname),
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
			'packages/*/*/dist',
			'packages/*/*/build',
			'examples/*/dist',
			'examples/*/.svelte-kit',
			'bin',
			'obj',
			'**/Generated/**',
			'**/generated/**',
			'packages/schemas/scripts/generate-*.js',
			'**/*.d.ts',
			'Plugin/Selva.GH/EmbeddedAssets/web',
			// Config files at package root — not in any tsconfig include, and
			// they don't need application linting.
			'packages/*/vitest.config.ts',
			'packages/*/*/vitest.config.ts',
			'packages/*/playwright.config.ts',
			'packages/*/*/playwright.config.ts',
			// @selvajs/compute is a standalone package with its OWN tsconfig and
			// eslint.config.mjs. Type-aware linting from this root would see two
			// candidate tsconfig roots (repo root + compute) and error under
			// typescript-eslint 8.64+. It's linted by its own `lint` script,
			// invoked from the root `lint` command (see package.json).
			'packages/compute/**',
			// @selvajs/visualization — same story as compute: own tsconfig +
			// eslint.config.mjs, linted by its own `lint` script from the root command.
			'packages/visualization/**'
		]
	},
	{
		files: ['scripts/**/*.{js,ts}'],
		rules: {
			'no-console': 'off'
		}
	},
	{
		// @selvajs/supabase-provider's tsconfig deliberately EXCLUDES tests from the
		// build (they must not emit into the published `dist`). But that also drops
		// them out of eslint 10's typed `projectService`, which then errors on every
		// test file with "not found by the project service". Every other package
		// includes tests in its tsconfig and lints fine; this package can't without
		// polluting its npm output. So disable typed parsing for these files only —
		// they still get every non-type-aware rule.
		files: [
			'packages/providers/supabase/src/**/__tests__/**/*.ts',
			'packages/providers/supabase/src/**/*.{test,spec}.ts'
		],
		languageOptions: {
			parserOptions: {
				projectService: false,
				project: null,
				program: null
			}
		}
	},
	{
		// Selva app server code should read env via SvelteKit's `$env/dynamic/private`,
		// not bare `process.env`: under `vite dev` Vite loads `.env` but does NOT
		// mirror it into `process.env`, so a raw read silently falls back to its
		// default in dev (right in prod, wrong in dev, no error). Warn-level so the
		// legit OS-level reads (NODE_ENV, PATH, HOME) can opt out with a documented
		// inline disable. Tests are excluded — the env stub spreads process.env on purpose.
		files: ['packages/selva/src/**/*.{ts,svelte}'],
		ignores: ['packages/selva/src/**/__tests__/**', 'packages/selva/src/**/*.{test,spec}.ts'],
		rules: {
			'no-restricted-properties': [
				'warn',
				{
					object: 'process',
					property: 'env',
					message:
						"Read env via `import { env } from '$env/dynamic/private'`, not bare `process.env` — Vite doesn't populate process.env from .env under `vite dev`, so overrides are silently ignored in dev. (OS-level NODE_ENV/PATH/HOME may opt out with an inline eslint-disable.)"
				}
			]
		}
	}
];
