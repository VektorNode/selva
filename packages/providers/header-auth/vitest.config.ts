import { defineConfig, defaultExclude } from 'vitest/config';

export default defineConfig({
	resolve: {
		// Read @selvajs/platform source directly via the `"selva-source"` export
		// condition so editing platform types doesn't require an upstream
		// rebuild between iterations.
		conditions: ['selva-source']
	},
	test: {
		// The build emits these test files into dist/ too, and vitest 4 dropped
		// `**/dist/**` from its default excludes — without this every suite runs
		// twice, against stale compiled output.
		exclude: [...defaultExclude, '**/dist/**'],
		// Stateless source-resolution tests — threads pool without isolation
		// skips worker-spawn overhead.
		pool: 'threads',
		isolate: false
	}
});
