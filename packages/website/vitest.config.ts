import { createVitestConfig } from '@selvajs/config/vitest';

// Node-only suite: checks of the repo-root `docs/` tree on disk and of the markdown plugins
// that render it, not rendered components.
export default createVitestConfig({
	test: {
		include: ['tests/**/*.test.ts', 'src/**/*.test.ts']
	}
});
