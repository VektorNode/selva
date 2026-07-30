import { defineConfig } from 'tsup';

const entries = {
	index: 'src/index.ts',
	shared: 'src/shared/index.ts',
	parse: 'src/parse/index.ts',
	render: 'src/render/index.ts',
	scene: 'src/scene/index.ts'
};

export default defineConfig({
	entry: entries,
	format: ['esm', 'cjs'],
	dts: true,
	splitting: true,
	minify: true,
	sourcemap: true,
	clean: true,
	external: ['three']
});
