import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		// Read @selvajs/platform source directly via the `"source"` export
		// condition — no `pnpm build:platform` between editing a rule and
		// running these tests.
		conditions: ['source']
	}
});
