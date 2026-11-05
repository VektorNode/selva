import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: {
		grasshopper: 'src/grasshopper/index.ts',
		core: 'src/core/index.ts'
	},
	format: ['esm'],
	dts: true,
	sourcemap: true,
	// On `platform: 'node'` the default emits `core.mjs`, which `exports` doesn't name.
	fixedExtension: false
});
