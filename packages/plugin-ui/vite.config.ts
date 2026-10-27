import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { createViteConfig } from '@selvajs/config/vite';

// The plugin accepts WebSocket connections only from pages on this exact origin in dev
// (AppConfig.UIBuilder.DevServerPort), so a fallback port would be refused. Fail loudly instead.
export default createViteConfig({
	kit: {
		preprocess: vitePreprocess(),
		compilerOptions: {
			runes: true
		},
		// Output embedded in the .gha; fallback to index.html for SPA-style client-side routing.
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: 'index.html',
			precompress: false,
			strict: false
		}),
		prerender: {
			entries: [],
			handleHttpError: 'warn'
		}
	},
	server: {
		port: 5173,
		strictPort: true,
		fs: {
			allow: ['..', '../../node_modules']
		}
	}
});
