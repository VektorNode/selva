import { config } from '../config/eslint.config.js';

/**
 * Shared flat config WITHOUT the type-aware `createConfig(__dirname)` wrapper,
 * same as `packages/visualization/eslint.config.mjs`: `projectService` requires
 * every linted file to belong to a tsconfig project, and this package's root
 * config files (`tsup.config.ts`, `vitest.config.ts`) sit outside `include`.
 */
export default [
	...config,
	{
		ignores: ['docs/api/', 'coverage/', 'examples/']
	},
	{
		// CLI maintenance scripts — console output is their interface.
		files: ['scripts/**/*.mjs'],
		rules: {
			'no-console': 'off'
		}
	}
];
