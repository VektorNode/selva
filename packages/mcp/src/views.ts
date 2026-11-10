import { readFile } from 'node:fs/promises';
import { appResource, type AppCsp } from './app.js';
import type { ResourceDefinition } from './server.js';

export const SOLVE_VIEW_URI = 'ui://selva/solve.html';

// `../dist/` resolves from both `src/` (the workspace's source condition) and `dist/`.
const SOLVE_VIEW_FILE = new URL('../dist/views/solve.html', import.meta.url);

let html: Promise<string> | undefined;

/**
 * Selva's 3D view: draws the geometry a tool hands it under `SOLVE_VIEW_KEY` in its result's
 * `_meta`. Name it in a tool's `ui: { resourceUri: SOLVE_VIEW_URI }`. It needs no `csp`: its
 * script and styles are inline, and `load` reaches geometry through the host, not `fetch`.
 */
export function solveView(options: { csp?: AppCsp } = {}): ResourceDefinition {
	return appResource({
		uri: SOLVE_VIEW_URI,
		name: 'Solve in 3D',
		description: 'The geometry of a solve, to orbit and zoom.',
		// A failed read isn't cached: in dev the file appears once `vite build` runs.
		html: () =>
			(html ??= readFile(SOLVE_VIEW_FILE, 'utf8').catch((err: unknown) => {
				html = undefined;
				throw err;
			})),
		...(options.csp && { csp: options.csp }),
		prefersBorder: true
	});
}
