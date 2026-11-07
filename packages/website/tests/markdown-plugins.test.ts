// The mdsvex plugins that turn the repo-root docs into site pages. A wrong rewrite here is
// silent: the page builds, and a link 404s or a diagram never renders.

import { describe, expect, it } from 'vitest';

import rehypeDocLinks from '../rehype-doc-links.js';
import rehypeMermaidSvgHtml from '../rehype-mermaid-svg-html.js';
import remarkMermaidBlock from '../remark-mermaid-block.js';

type Node = {
	type: string;
	tagName?: string;
	value?: string;
	lang?: string;
	properties?: Record<string, unknown>;
	children?: Node[];
	data?: Record<string, unknown>;
};

const GITHUB_BLOB = 'https://github.com/vektornode/selva/blob/main';

/** Runs rehypeDocLinks over one link, as found in `docs/<fromDoc>`. */
function rewrite(
	href: string,
	fromDoc = 'self-hosting/get-started/quick-start.md',
	text = 'x'
): Record<string, unknown> {
	const properties: Record<string, unknown> = { href };
	const label: Node = { type: 'text', value: text };
	const tree: Node = {
		type: 'root',
		children: [{ type: 'element', tagName: 'a', properties, children: [label] }]
	};
	rehypeDocLinks()(tree, { filename: `/repo/docs/${fromDoc}` });
	return { ...properties, text: label.value };
}

describe('rehypeDocLinks', () => {
	it('keeps a sibling link inside its subfolder', () => {
		expect(rewrite('prerequisites.md').href).toBe('/docs/self-hosting/get-started/prerequisites');
	});

	it('resolves a relative doc link and keeps its anchor', () => {
		expect(rewrite('../deployment/caddy.md#tls').href).toBe(
			'/docs/self-hosting/deployment/caddy#tls'
		);
	});

	it('slugs a doc the way docs.ts routes it: lowercased, nothing split', () => {
		expect(rewrite('RhinoCompute.md', 'architecture.md').href).toBe('/docs/rhinocompute');
	});

	it('sends a file outside docs/ to GitHub in a new tab', () => {
		expect(rewrite('../../../packages/ui/README.md')).toMatchObject({
			href: `${GITHUB_BLOB}/packages/ui/README.md`,
			target: '_blank',
			rel: 'noreferrer'
		});
	});

	it('sends a non-doc file inside docs/ to GitHub', () => {
		expect(rewrite('../images/flow.png').href).toBe(
			`${GITHUB_BLOB}/docs/self-hosting/images/flow.png`
		);
	});

	it('opens an absolute link in a new tab without touching it', () => {
		expect(rewrite('https://example.com/a')).toMatchObject({
			href: 'https://example.com/a',
			target: '_blank'
		});
	});

	it.each(['#setup', '/docs/what-is-selva', 'mailto:hi@example.com'])('leaves %s alone', (href) => {
		expect(rewrite(href)).toEqual({ href, text: 'x' });
	});

	it('turns a filename label into words', () => {
		expect(rewrite('../plugin/RhinoCompute.md', undefined, 'RhinoCompute.md').text).toBe(
			'Rhino Compute'
		);
	});
});

describe('remarkMermaidBlock', () => {
	it('turns a mermaid fence into a language-mermaid code element the highlighter skips', () => {
		const fence: Node = { type: 'code', lang: 'mermaid', value: 'graph TD; A-->B' };
		const other: Node = { type: 'code', lang: 'ts', value: 'let a = 1;' };
		remarkMermaidBlock()({ type: 'root', children: [fence, other] });

		expect(fence.type).toBe('mermaidBlock');
		expect(fence.data).toEqual({
			hName: 'pre',
			hChildren: [
				{
					type: 'element',
					tagName: 'code',
					properties: { className: ['language-mermaid'] },
					children: [{ type: 'text', value: 'graph TD; A-->B' }]
				}
			]
		});
		expect(other).toEqual({ type: 'code', lang: 'ts', value: 'let a = 1;' });
	});
});

describe('rehypeMermaidSvgHtml', () => {
	it('passes an svg through {@html} with backticks and backslashes escaped', () => {
		const svg: Node = {
			type: 'element',
			tagName: 'svg',
			properties: {},
			children: [{ type: 'text', value: 'a`b\\c {x}' }]
		};
		const tree: Node = { type: 'root', children: [svg] };
		rehypeMermaidSvgHtml()(tree);

		expect(tree.children).toEqual([
			{
				type: 'raw',
				value: '<figure class="diagram">{@html `<svg>a\\`b\\\\c {x}</svg>`}</figure>'
			}
		]);
	});
});
