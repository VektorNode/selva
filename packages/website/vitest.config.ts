import { createVitestConfig } from '@selvajs/config/vitest';

// Node-only suite: this package's tests check the repo-root `docs/` tree on
// disk (structure + link integrity), not rendered components.
export default createVitestConfig({
	test: {
		include: ['tests/**/*.test.ts']
	}
});
