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
			const bytes = Buffer.from(await read(url).arrayBuffer());
			return `data:application/octet-stream;base64,${bytes.toString('base64')}`;
		}
	);
	// A failed read isn't kept: the next capture tries again.
	hdr.catch(() => (hdr = undefined));
	return hdr;
}
