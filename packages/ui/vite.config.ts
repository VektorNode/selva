import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { createViteConfig } from '@selvajs/config/vite';

export default createViteConfig({
	kit: {
		preprocess: vitePreprocess(),
		adapter: adapter(),
		paths: { base: '' },
		onwarn: (warning, handler) => {
			// Ignore SvelteKit generated file warnings
			if (warning.filename?.includes('.svelte-kit/generated')) {
				return;
			}
			handler(warning);
		}
	}
});
