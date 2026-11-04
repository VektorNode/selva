import adapterNode from '@sveltejs/adapter-node';
import type { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Shared by vite.config.ts and vitest.config.ts so tests resolve and compile like the app.
export const kit: Parameters<typeof sveltekit>[0] = {
	preprocess: vitePreprocess(),
	compilerOptions: {
		runes: true
	},
	adapter: adapterNode({
		out: 'build',
		precompress: true
	}),
	// The form-CSRF check runs in hooks.server.ts instead, which can exempt the
	// OAuth token endpoint and bearer-authenticated uploads. `*` turns this one off.
	csrf: { trustedOrigins: ['*'] }
};
