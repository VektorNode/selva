import { defineConfig, defaultExclude } from 'vitest/config';

export default defineConfig({
	resolve: {
		// Read @selvajs/platform source directly via the `"source"` export
		// condition — no upstream rebuild needed between editing a rule and
		// running these tests.
		conditions: ['source']
	},
	test: {
		// The build emits these test files into dist/ too, and vitest 4 dropped
		// `**/dist/**` from its default excludes — without this every suite runs
		// twice, against stale compiled output.
		exclude: [...defaultExclude, '**/dist/**']
	}
});
