import { defineConfig } from 'vitest/config';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Minimal config: pure-TS logic tests only (no SvelteKit / Tailwind). Avoid pulling in the
// full vite config so tests don't need a kit prepare step.
//
// `conditions: ['svelte']` is required because @selvajs/ui only publishes a `svelte` export
// condition; without it, node-env resolution of imports like `getDefaultValue` (reached via
// features/preview/handlers.ts) fails with "No known conditions for '.'". The pure cores
// under test pull that module transitively even though they only use its non-UI helpers.
export default defineConfig({
	resolve: {
		alias: {
			$lib: path.resolve(__dirname, 'src/lib'),
			// @selvajs/ui's barrel re-exports `.svelte` components that this svelte-plugin-free
			// vitest can't parse, and it only publishes a `svelte` export condition the node-env
			// resolver won't request. The pure logic under test reaches it (via
			// features/preview/handlers.ts) only for the non-UI `getDefaultValue` helper, so we
			// alias it to a tiny stub re-exporting just that. Keeps production imports untouched.
			'@selvajs/ui': path.resolve(__dirname, 'src/test/selvajs-ui-stub.ts')
		}
	},
	test: {
		include: ['src/**/*.{test,spec}.ts'],
		environment: 'node'
	}
});
