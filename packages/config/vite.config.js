import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { mergeConfig, defaultClientConditions, defaultServerConditions } from 'vite';

/**
 * @param {import('vite').UserConfig & { kit?: Parameters<typeof sveltekit>[0] }} options
 *   `kit` goes to the SvelteKit plugin; the rest is merged into the Vite config.
 */
export function createViteConfig({ kit, ...overrides } = {}) {
	return mergeConfig(
		{
			plugins: [tailwindcss(), sveltekit(kit)],
			// Resolve @selvajs/* through the "selva-source" export condition (monorepo dev vs npm consumers).
			resolve: {
				conditions: ['selva-source', ...defaultClientConditions],
				// Force a single physical copy of these. pnpm's peer resolution can
				// split @sveltejs/kit across multiple vite instances, which splits it
				// into multiple module instances; mixing them breaks SvelteKit's
				// `instanceof Redirect`/`HttpError` control-flow checks, so a normal
				// `redirect()` surfaces as an "[Unhandled error]" 500 instead.
				dedupe: ['@sveltejs/kit', 'svelte', 'vite']
			},
			// Force-bundle @selvajs/* into SSR build (no external runtime deps).
			ssr: {
				resolve: {
					conditions: ['selva-source', ...defaultServerConditions]
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
