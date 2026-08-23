import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createVitestConfig } from '@selvajs/config/vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default createVitestConfig({
	resolve: {
		alias: {
			// SvelteKit virtual modules — replicate just what server-side tests need.
			$lib: path.resolve(__dirname, 'src/lib'),
			'$env/dynamic/private': path.resolve(__dirname, 'src/lib/server/__tests__/env-stub.ts')
		}
	},
	test: {
		setupFiles: ['./src/lib/server/__tests__/setup.ts'],
		testTimeout: 15000,
		hookTimeout: 15000,
		// Forks, not threads: the `currentTestProviders()` holder in
		// __tests__/test-providers.ts is module-level state, so every test file
		// needs its own module registry. Files still run in parallel — each test
		// roots itself in its own `fs.mkdtemp` directory, so there is nothing for
		// concurrent files to contend over.
		pool: 'forks'
	}
});
