import type { RhinoModule } from 'rhino3dm';

/**
 * rhino3dm for the browser, fetched when a curve input first needs it: 2.7 MB of WebAssembly.
 *
 * The ES build, not the package's main: that one is UMD with a `require("ws")` no browser bundle
 * can resolve. Its own wasm lookup breaks under Vite's dependency pre-bundling, which moves the
 * script away from the file, so the URL is handed over instead.
 */
export async function loadRhino(): Promise<RhinoModule> {
	const [{ default: rhino3dm }, { default: wasmUrl }] = await Promise.all([
		import('rhino3dm/rhino3dm.module.js'),
		import('rhino3dm/rhino3dm.wasm?url')
	]);
	return rhino3dm({ locateFile: () => wasmUrl });
}
