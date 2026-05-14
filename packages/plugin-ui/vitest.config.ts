import { defineConfig } from 'vitest/config';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Minimal config: only the wire-format validator has tests today, and it's pure
// TS with no SvelteKit / Tailwind dependency. Avoid pulling in the full vite
// config so tests don't need a kit prepare step.
export default defineConfig({
	resolve: {
		alias: {
			$lib: path.resolve(__dirname, 'src/lib')
		}
	},
	test: {
		include: ['src/**/*.{test,spec}.ts'],
		environment: 'node'
	}
});
