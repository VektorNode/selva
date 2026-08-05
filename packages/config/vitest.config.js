import { defineConfig, defaultExclude, mergeConfig } from 'vitest/config';

/**
 * Shared vitest base. Everything here is a rule that more than one package needs
 * and that fails *silently* when a package forgets it — see each note below.
 *
 * Anything a single package needs (setup files, path aliases, plugins, timeouts)
 * belongs in that package's override, not here.
 *
 * Do NOT add `isolate: false`. Ten test files across six packages call `vi.mock()`;
 * with a shared module graph, whichever file imports the target first wins and the
 * mock silently never applies. That failure is order-dependent — it passes locally
 * and fails on CI.
 *
 * @param {import('vitest/config').UserConfig} overrides
 */
export function createVitestConfig(overrides = {}) {
	return mergeConfig(
		defineConfig({
			resolve: {
				// Read workspace @selvajs/* packages as TypeScript source, so editing an
				// upstream package doesn't need a rebuild before its consumers' tests see
				// the change. Production resolution picks `import` (dist/) instead.
				conditions: ['selva-source']
			},
			test: {
				exclude: [
					...defaultExclude,
					// tsc-built packages emit their test files into dist/ alongside the
					// build output, and vitest 4 dropped `**/dist/**` from its default
					// excludes — without this every suite runs twice against stale
					// compiled output.
					'**/dist/**',
					// Playwright specs. Vitest would otherwise collect them and fail on
					// the `@playwright/test` import.
					'**/e2e/**'
				]
			}
		}),
		overrides
	);
}
