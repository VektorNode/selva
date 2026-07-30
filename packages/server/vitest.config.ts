import { defineConfig, defaultExclude } from 'vitest/config';

export default defineConfig({
	test: {
		// `tsc` emits the test files into dist/ alongside the build output, and
		// vitest 4 dropped `**/dist/**` from its default excludes — without this
		// every suite runs twice, and the dist copy fails outright because
		// fixtures resolved from `import.meta.url` (e.g. the .mjs config
		// override) are never emitted by tsc.
		exclude: [...defaultExclude, '**/dist/**']
	}
});
