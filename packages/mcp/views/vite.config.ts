import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// A client serves a view as one document under a CSP that allows no outside script, so the
// build inlines everything into `dist/views/<name>.html`.
export default defineConfig({
	root: resolve(import.meta.dirname, 'solve'),
	plugins: [viteSingleFile()],
	build: {
		outDir: resolve(import.meta.dirname, '../dist/views'),
		emptyOutDir: false,
		rollupOptions: { input: resolve(import.meta.dirname, 'solve/solve.html') }
	}
});
