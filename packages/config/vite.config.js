import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { mergeConfig, defaultClientConditions, defaultServerConditions } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const uiSrcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'ui', 'src');
const uiLibDir = path.join(uiSrcDir, 'lib');

/**
 * `child` relative to `parent` ('' when equal), or null if outside. Case- and
 * separator-insensitive on Windows.
 * @param {string} parent
 * @param {string} child
 */
function relativeInside(parent, child) {
	const rel = path.relative(parent, child.split('?')[0]);
	return !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : null;
}

/**
 * The "selva-source" condition serves @selvajs/ui from its source, so its edits hot-reload in
 * every app without a build. That source imports through SvelteKit's `$lib`, which the
 * consuming app aliases to ITS OWN src/lib before any plugin runs. For imports written inside
 * packages/ui/src, move them back to @selvajs/ui's lib.
 * @returns {import('vite').Plugin}
 */
function selvaUiLibAlias() {
	let appLibDir = '';
	return {
		name: 'selva-ui-lib-alias',
		enforce: 'pre',
		configResolved(config) {
			appLibDir = path.join(config.root, 'src', 'lib');
		},
		resolveId(source, importer, options) {
			if (!importer || appLibDir === uiLibDir || relativeInside(uiSrcDir, importer) === null) {
				return null;
			}
			const rest =
				source === '$lib' || source.startsWith('$lib/')
					? source.slice('$lib/'.length)
					: path.isAbsolute(source)
						? relativeInside(appLibDir, source)
						: null;
			if (rest === null) return null;
			return this.resolve(path.join(uiLibDir, rest), importer, { ...options, skipSelf: true });
		}
	};
}

/** @param {import('vite').UserConfig} overrides */
export function createViteConfig(overrides = {}) {
	return mergeConfig(
		{
			plugins: [tailwindcss(), selvaUiLibAlias(), sveltekit()],
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
