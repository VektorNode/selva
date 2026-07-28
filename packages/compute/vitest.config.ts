import path from 'path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		// Per-file isolation is REQUIRED: several suites use `vi.mock()` to replace
		// modules (render-pipeline's GTAOPass, solve-scheduler-hash-memo's
		// stable-hash, grasshopper-response-processor's file downloader). With
		// `isolate: false` the module graph is shared across files in one worker,
		// so whichever file imports the target first wins and the mock silently
		// never applies — the failure is order-dependent, so it passes locally and
		// fails on CI. If you want the ~20% speedup back, first remove every
		// `vi.mock` from this package.
		pool: 'threads',
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
