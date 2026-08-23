import { resolve } from 'path';

import { defineConfig } from 'vite';

/**
 * Dev-only config for the `examples/` playground (`pnpm example`). The package itself is built with
 * tsup — this config never produces the shipped bundle.
 *
 * `three` is a peer dependency, so the demos resolve it from the workspace devDependency; the `@`
 * alias points at `src/` so demos import the same paths the package's own sources use.
 */
export default defineConfig({
	resolve: {
		alias: {
			'@': resolve(__dirname, 'src')
		}
	},
	root: 'examples',
	server: {
		port: 5173,
		open: '/index.html',
		// The DMF fixtures live under `examples/fixtures`, inside the root — but allow the parent so
		// `?url` imports that reach outside it keep resolving.
		fs: { allow: ['..'] }
	}
});
