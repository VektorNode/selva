import path from 'path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		// Per-file isolation is REQUIRED while any suite uses `vi.mock()` to replace a module.
		// With `isolate: false` the module graph is shared across files in one worker, so whichever
		// file imports the target first wins and the mock silently never applies — an
		// order-dependent failure that passes locally and fails on CI.
		pool: 'threads',
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			exclude: ['node_modules/', 'dist/', '**/*.test.ts', '**/*.bench.ts']
		}
	},
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
			'@tests': path.resolve(__dirname, './tests')
		}
	}
});
