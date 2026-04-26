import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		// Read @selva/platform source directly via the `"source"` export
		// condition — no `pnpm build:platform` between editing a rule and
		// running these tests.
		conditions: ['source']
	}
});
