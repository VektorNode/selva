import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { mergeConfig, defaultClientConditions, defaultServerConditions } from 'vite';

/** @param {import('vite').UserConfig} overrides */
export function createViteConfig(overrides = {}) {
	return mergeConfig(
		{
			plugins: [tailwindcss(), sveltekit()],
			// Resolve internal @selvajs/* packages through their "source" export
			// condition (the same one vitest uses). For @selvajs/ui this swaps its
			// published, curated public entry for the full barrel — so monorepo apps
			// keep importing primitives/layout/toast from '@selvajs/ui', while npm
			// consumers (who don't set this condition) only ever see the public
			// compute-app SDK.
			resolve: {
				// Prepend, don't replace: bare `conditions: ['source']` would drop
				// Vite's defaults (module/browser/import/…) and break SvelteKit's
				// virtual-module resolution. Keep defaults, just prefer "source".
				conditions: ['source', ...defaultClientConditions]
			},
			// Force-bundle internal @selvajs/* packages into the SSR build so
			// the published @selvajs/selva tarball doesn't need them installable
			// at runtime. Without this they'd appear as bare `require('@selvajs/…')`
			// calls in build/, which would crash on any operator that doesn't
			// also install platform + provider packages — defeating the
			// "one install gets you everything" model.
			ssr: {
				// Same "source" condition for the SSR graph — selva renders
				// ComputeApp server-side and bundles @selvajs/ui (below).
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
