import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	compilerOptions: {
		runes: true,
	},

	kit: {
		// Library mode - no adapter needed
		// @sveltejs/package will handle the build
	}
};

export default config;
