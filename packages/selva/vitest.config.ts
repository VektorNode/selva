import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sveltekit } from '@sveltejs/kit/vite';
import { createVitestConfig } from '@selvajs/config/vitest';

import { kit } from './kit.config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default createVitestConfig({
	// Not a merge of vite.config.ts: its dotenv plugin would load a developer's .env
	// into the test process.
	plugins: [sveltekit(kit)],
	resolve: {
		alias: {
			'#lib/server/env.js': path.resolve(__dirname, 'src/lib/server/__tests__/env-stub.ts')
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
