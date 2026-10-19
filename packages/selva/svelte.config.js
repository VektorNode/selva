import adapterNode from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	compilerOptions: {
		runes: true
	},

	kit: {
		adapter: adapterNode({
			out: 'build',
			precompress: true
		}),
		// The form-CSRF check runs in hooks.server.ts instead, which can exempt the
		// OAuth token endpoint and bearer-authenticated uploads. `*` turns this one off.
		csrf: { trustedOrigins: ['*'] }
	}
};

export default config;
