import { defineConfig } from 'vitest/config';

// Node-only suite: this package's tests check the repo-root `docs/` tree on
// disk (structure + link integrity), not rendered components.
export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['tests/**/*.test.ts']
	}
});
