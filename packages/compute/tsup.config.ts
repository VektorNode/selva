import { defineConfig } from 'tsup';

const entries = {
	index: 'src/index.ts',
	grasshopper: 'src/grasshopper.ts',
	core: 'src/core/index.ts'
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
