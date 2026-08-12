import { config } from '../config/eslint.config.js';

/**
 * Mirrors `packages/visualization/eslint.config.mjs`: the shared flat config, WITHOUT the type-aware
 * `createConfig(__dirname)` wrapper.
 *
 * `createConfig` enables `parserOptions.projectService`, which then requires every linted file to
 * belong to a tsconfig project. Root config files (`tsup.config.ts`, `vitest.config.ts`) sit outside
 * this package's `include` (`src/**`, `tests/**`) on purpose, so type-aware linting fails on them
 * with "was not found by the project service".
 */
export default [
	...config,

	/**
	 * The client/server boundary (plan Phase 4, guard 2).
	 *
	 * `client/` ships to a browser. A single import reaching into `server/` — or into anything
	 * server-only it depends on — pulls storage credentials and `process.env` reads into a client
	 * bundle. The no-root-barrel decision in `tsup.config.ts` stops a *consumer* from crossing the
	 * line; this stops the package itself from crossing it internally, in-editor, before a bundle
	 * exists to test.
	 */
	{
		files: ['src/client/**/*.ts'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['../server', '../server/*', '**/server/**'],
							message:
								'client/ must never import server/ — it would pull server-only code into a browser bundle. Put anything both halves need in shared/.'
						},
						{
							group: ['@selvajs/platform', '@selvajs/platform/*', '@selvajs/server', '@selvajs/server/*', 'node:*'],
							message:
								'client/ runs in a browser: no platform providers, no server plumbing, no node builtins.'
						}
					]
				}
			]
		}
	}
];
