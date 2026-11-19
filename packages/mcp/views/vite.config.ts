import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// A client serves a view as one document under a CSP that allows no outside script, so the
// build inlines everything into `dist/views/<name>.html`. A single-file build takes one entry,
// so each view is its own run: `--mode capture` builds the capture page, any other the solve view.
export default defineConfig(({ mode }) => {
	const view = mode === 'capture' ? 'capture' : 'solve';
	return {
		root: resolve(import.meta.dirname, view),
		plugins: [viteSingleFile()],
		build: {
			outDir: resolve(import.meta.dirname, '../dist/views'),
			emptyOutDir: false,
			rollupOptions: { input: resolve(import.meta.dirname, `${view}/${view}.html`) }
		}
	};
});
