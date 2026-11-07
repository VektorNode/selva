import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { svelte } from '@sveltejs/vite-plugin-svelte';

import { createVitestConfig } from '@selvajs/config/vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Logic tests under node, no SvelteKit or Tailwind, so no kit prepare step. The svelte plugin
// compiles `.svelte.ts` rune modules (the WebSocket client) so their logic runs; nothing mounts.
export default createVitestConfig({
	plugins: [svelte()],
	resolve: {
		alias: {
			// @selvajs/ui's barrel re-exports `.svelte` components that need the kit pipeline, and
			// only publishes a `svelte` export condition the node-env resolver won't request. The
			// logic under test needs only its non-UI helpers, so alias it to a stub that re-exports
			// those. Production imports are untouched.
			'@selvajs/ui': path.resolve(__dirname, 'src/test/selvajs-ui-stub.ts')
		}
	}
});
