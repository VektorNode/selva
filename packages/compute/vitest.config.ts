import path from 'path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		// Pure-logic suite with no shared filesystem/global state — run in the
		// threads pool without per-file isolation to skip worker-process spawn
		// overhead (~20% faster). Do NOT copy this to suites that own a tmpdir or
		// mutate a global holder (selva, local-provider) — they need isolation.
		pool: 'threads',
		isolate: false,
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			exclude: ['node_modules/', 'dist/', 'types/', '**/*.test.ts', '**/*.spec.ts']
		},
		setupFiles: ['./tests/setup.ts']
	},
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
			'@tests': path.resolve(__dirname, './tests')
		}
	}
});
