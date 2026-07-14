import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Tests cover the pure schema/logic modules plus `.svelte.ts` rune modules (the throttle
// and solve-session wrapper). The svelte plugin lets `$state`/`$derived` runes compile and
// run in tests — this is rune *module* execution, NOT component mounting (no DOM, no
// Tailwind/kit pipeline needed). Component mounting is still out of scope.
export default defineConfig({
	plugins: [svelte()],
	resolve: {
		alias: {
			$lib: path.resolve(__dirname, 'src/lib')
		}
	},
	test: {
		include: ['src/**/*.{test,spec}.ts'],
		environment: 'node',
		// Pure schema/logic + rune-module tests, no shared state — threads pool
		// without isolation skips worker-spawn overhead.
		pool: 'threads',
		isolate: false
	}
});
