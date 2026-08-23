import { defineConfig } from 'tsdown';

const entries = {
	index: 'src/index.ts',
	grasshopper: 'src/grasshopper/index.ts',
	core: 'src/core/index.ts'
};

export default defineConfig({
	entry: entries,
	format: ['esm', 'cjs'],
	dts: true,
	minify: true,
	sourcemap: true,
	clean: true,
	fixedExtension: false
});
