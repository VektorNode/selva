import { defineConfig } from 'tsdown';

// No root entry: `model` and `io` must stay importable without pulling `three` in through `tool`.
const entries = {
	model: 'src/model/index.ts',
	io: 'src/io/index.ts',
	tool: 'src/tool/index.ts'
};

export default defineConfig({
	entry: entries,
	format: ['esm'],
	dts: true,
	sourcemap: true,
	clean: true,
	fixedExtension: false,
	external: ['three', /^three\//, /^@selvajs\/visualization/, 'rhino3dm']
});
