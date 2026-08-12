import { defineConfig } from 'tsdown';

// `shared/` is intentionally absent: it is the internal cross-layer surface, not a published
// entrypoint. What consumers need from it is re-exported by `render/`.
const entries = {
	index: 'src/index.ts',
	parse: 'src/parse/index.ts',
	render: 'src/render/index.ts',
	scene: 'src/scene/index.ts'
};

export default defineConfig({
	entry: entries,
	format: ['esm', 'cjs'],
	dts: true,
	minify: true,
	sourcemap: true,
	clean: true,
	fixedExtension: false,
	external: ['three']
});
