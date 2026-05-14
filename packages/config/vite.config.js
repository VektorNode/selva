import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { mergeConfig } from 'vite';

/** @param {import('vite').UserConfig} overrides */
export function createViteConfig(overrides = {}) {
	return mergeConfig(
		{
			plugins: [tailwindcss(), sveltekit()],
			// Force-bundle internal @selvajs/* packages into the SSR build so
			// the published @selvajs/selva tarball doesn't need them installable
			// at runtime. Without this they'd appear as bare `require('@selvajs/…')`
			// calls in build/, which would crash on any operator that doesn't
			// also install platform + provider packages — defeating the
			// "one install gets you everything" model.
			ssr: {
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
