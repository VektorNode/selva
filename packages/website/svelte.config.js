import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { mdsvex } from 'mdsvex';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeMermaid from 'rehype-mermaid';
import rehypeDocLinks from './rehype-doc-links.js';
import remarkMermaidBlock from './remark-mermaid-block.js';
import rehypeMermaidSvgHtml from './rehype-mermaid-svg-html.js';

/** @type {import('mdsvex').MdsvexOptions} */
const mdsvexOptions = {
	extensions: ['.md'],
	// remarkMermaidBlock turns ```mermaid fences into real HAST elements (bypassing
	// the syntax highlighter); rehypeMermaid then renders them to inline SVG at build
	// time via Playwright — no client-side JS.
	remarkPlugins: [remarkMermaidBlock],
	rehypePlugins: [
		[
			rehypeMermaid,
			{
				strategy: 'inline-svg',
				// Themed to the site's dark forest palette (hex equivalents of the
				// oklch theme tokens — mermaid doesn't accept oklch).
				mermaidConfig: {
					theme: 'base',
					themeVariables: {
						darkMode: true,
						background: '#16201a',
						fontFamily: 'inherit',
						primaryColor: '#1e2a22', // node fill (card)
						primaryBorderColor: '#7cc47f', // node border (primary green)
						primaryTextColor: '#e8ebe3', // node text (foreground)
						secondaryColor: '#1e2a22',
						tertiaryColor: '#16201a', // subgraph fill (background)
						tertiaryBorderColor: '#3a473d', // subgraph border
						tertiaryTextColor: '#e8ebe3',
						lineColor: '#7cc47f', // edges
						textColor: '#e8ebe3',
						clusterBkg: '#16201a',
						clusterBorder: '#3a473d',
						edgeLabelBackground: '#16201a'
					}
				}
			}
		],
		rehypeMermaidSvgHtml,
		rehypeDocLinks,
		rehypeSlug,
		[rehypeAutolinkHeadings, { behavior: 'append' }]
	],
	highlight: {
		// Shiki via mdsvex's built-in highlighter, themed dark to match the site.
		highlighter: async (code, lang = 'text') => {
			const { codeToHtml, bundledLanguages } = await import('shiki');
			// Fall back to plaintext for languages Shiki doesn't bundle (e.g. caddyfile).
			const safeLang = lang in bundledLanguages ? lang : 'text';
			const shiki = await codeToHtml(code, { lang: safeLang, theme: 'github-dark' });
			// Wrap in a container and stash the raw source (base64, so quotes/braces
			// can't break the markup) for the client-side copy button to read back.
			const encoded = Buffer.from(code, 'utf-8').toString('base64');
			const html = `<div class="code-block" data-code="${encoded}">${shiki}<button type="button" class="code-copy" aria-label="Copy code">Copy</button></div>`;
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
