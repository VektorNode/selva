import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		// Read @selvajs/platform source directly via the `"source"` export
		// condition so editing platform types doesn't require an upstream
		// rebuild between iterations.
		conditions: ['source']
	}
});
