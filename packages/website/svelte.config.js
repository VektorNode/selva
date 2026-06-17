import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { mdsvex } from 'mdsvex';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeDocLinks from './rehype-doc-links.js';

/** @type {import('mdsvex').MdsvexOptions} */
const mdsvexOptions = {
	extensions: ['.md'],
	rehypePlugins: [rehypeDocLinks, rehypeSlug, [rehypeAutolinkHeadings, { behavior: 'append' }]],
	highlight: {
		// Shiki via mdsvex's built-in highlighter, themed dark to match the site.
		highlighter: async (code, lang = 'text') => {
			const { codeToHtml, bundledLanguages } = await import('shiki');
			// Fall back to plaintext for languages Shiki doesn't bundle (e.g. caddyfile).
			const safeLang = lang in bundledLanguages ? lang : 'text';
			const html = await codeToHtml(code, { lang: safeLang, theme: 'github-dark' });
			// Escape curly braces so Svelte doesn't treat them as expressions.
			const escaped = html.replace(/[{}]/g, (c) => (c === '{' ? '&#123;' : '&#125;'));
			return `{@html \`${escaped.replace(/`/g, '\\`')}\`}`;
		}
	}
};

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Treat .svelte and .md as components/pages so docs can render as routes.
	extensions: ['.svelte', '.md'],

	preprocess: [vitePreprocess(), mdsvex(mdsvexOptions)],

	compilerOptions: {
		runes: true
	},

	kit: {
		// Fully static marketing site — every route is prerendered to HTML.
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: undefined,
			precompress: false,
			strict: true
		}),
		prerender: {
			// Docs may link to unpublished docs or anchors; warn instead of failing.
			handleHttpError: 'warn',
			handleMissingId: 'warn'
		}
	}
};

export default config;
