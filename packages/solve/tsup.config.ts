import { defineConfig } from 'tsup';

/**
 * Sub-path entries only — there is deliberately NO root barrel.
 *
 * A root `index` re-exporting both halves would let a browser bundle reach `server/` through one
 * innocent-looking import, defeating every other client/server guard in the package. Adding one is
 * a boundary change, not a convenience.
 */
const entries = {
	shared: 'src/shared/index.ts',
	client: 'src/client/index.ts',
	server: 'src/server/index.ts'
};

export default defineConfig({
	entry: entries,
	format: ['esm', 'cjs'],
	dts: true,
	splitting: true,
	minify: true,
	sourcemap: true,
	clean: true
});
