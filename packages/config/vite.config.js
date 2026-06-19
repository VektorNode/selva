import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { mergeConfig, defaultClientConditions, defaultServerConditions } from 'vite';

/** @param {import('vite').UserConfig} overrides */
export function createViteConfig(overrides = {}) {
	return mergeConfig(
		{
			plugins: [tailwindcss(), sveltekit()],
			// Resolve @selvajs/* through "source" export condition (monorepo dev vs npm consumers).
			resolve: {
				conditions: ['source', ...defaultClientConditions],
				// Force a single physical copy of these. The monorepo resolves
				// @sveltejs/kit against two vite majors (7 and 8), which splits it
				// into multiple module instances; mixing them breaks SvelteKit's
				// `instanceof Redirect`/`HttpError` control-flow checks, so a normal
				// `redirect()` surfaces as an "[Unhandled error]" 500 instead.
				dedupe: ['@sveltejs/kit', 'svelte', 'vite']
			},
			// Force-bundle @selvajs/* into SSR build (no external runtime deps).
			ssr: {
				resolve: {
					conditions: ['source', ...defaultServerConditions]
				},
				noExternal: [
					'@selvajs/platform',
					'@selvajs/local-provider',
					'@selvajs/supabase-provider',
					'@selvajs/header-auth-provider',
					'@selvajs/schemas',
					'@selvajs/ui'
				]
			}
		},
		overrides
	);
}
