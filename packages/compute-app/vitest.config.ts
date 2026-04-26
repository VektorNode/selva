import { defineConfig } from 'vitest/config';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	resolve: {
		alias: {
			// SvelteKit virtual modules — replicate just what server-side tests need.
			$lib: path.resolve(__dirname, 'src/lib'),
			'$env/dynamic/private': path.resolve(
				__dirname,
				'src/lib/server/__tests__/env-stub.ts'
			)
		}
	},
	test: {
		include: ['src/**/*.{test,spec}.ts'],
		setupFiles: ['./src/lib/server/__tests__/setup.ts'],
		environment: 'node',
		testTimeout: 15000,
		hookTimeout: 15000,
		// Each test owns a tmpdir; serial avoids cross-test contention and keeps
		// the global `currentTestProviders()` holder unambiguous.
		fileParallelism: false,
		pool: 'forks',
		poolOptions: { forks: { singleFork: true } }
	}
});
