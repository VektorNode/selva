import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { appResource, SOLVE_VIEW_URI, type ResourceDefinition } from '@selvajs/mcp';

// `?raw`, not `solveView()`: that reads the file beside its own module, which bundling moves.
// Loaded on first read: each page is a megabyte of inlined viewer.
const solveHtml = () => import('@selvajs/mcp/views/solve.html?raw').then((m) => m.default);

/** The page `selva_capture_preview` renders in, for `captureSolve`. */
export const captureHtml = () =>
	import('@selvajs/mcp/views/capture.html?raw').then((m) => m.default);

export function selvaViews(): ResourceDefinition[] {
	return [
		appResource({
			uri: SOLVE_VIEW_URI,
			name: 'Solve in 3D',
			description: 'The geometry of a solve, to orbit and zoom.',
			html: solveHtml,
			prefersBorder: true
		})
	];
}

let hdr: Promise<string> | undefined;

/**
 * The environment Selva's viewer lights with, as a `data:` URL: the capture page loads nothing
 * from Selva's origin, which the server may not be able to reach from inside.
 */
export function captureHdr(): Promise<string> {
	hdr ??= Promise.all([import('$app/server'), import('../../../../static/baseHDR.hdr?url')]).then(
		async ([{ read }, { default: url }]) => {
			let bytes: Buffer;
			try {
				bytes = Buffer.from(await read(url).arrayBuffer());
			} catch (err) {
				// `read` knows only assets the server bundle emitted; a file Vite served from
				// `static/` sits in the client build beside the entry (`build/client/` from `build/index.js`).
				const entry = process.argv[1] ? dirname(process.argv[1]) : process.cwd();
				const file = join(entry, 'client', url.replace(/^\//, ''));
				if (!existsSync(file)) throw err;
				bytes = await readFile(file);
			}
			return `data:application/octet-stream;base64,${bytes.toString('base64')}`;
		}
	);
	// A failed read isn't kept: the next capture tries again.
	hdr.catch(() => (hdr = undefined));
	return hdr;
}
