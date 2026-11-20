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

/**
 * The environment Selva's viewer lights with, as a `data:` URL: the capture page loads nothing
 * from Selva's origin, which the server may not be able to reach from inside. Inlined at build
 * time, not read with `$app/server`'s `read`: a lazily imported asset never reaches the
 * production manifest, so `read` fails there and only there.
 */
export const captureHdr = () =>
	import('../../../../static/baseHDR.hdr?inline').then((m) => m.default as string);
