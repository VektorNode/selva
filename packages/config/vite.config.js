import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { mergeConfig } from 'vite';

/** @param {import('vite').UserConfig} overrides */
export function createViteConfig(overrides = {}) {
	return mergeConfig(
		{
			plugins: [tailwindcss(), sveltekit()]
		},
		overrides
	);
}
