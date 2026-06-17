import { visit } from 'unist-util-visit';

/**
 * Rewrite ```mermaid fenced code blocks into a real HAST element
 * (`<pre><code class="language-mermaid">…</code></pre>`) via the mdast `data.hName`/
 * `hChildren` hook. We give the node a custom type so mdsvex's syntax highlighter
 * (which visits `type: 'code'`) skips it, while mdast-util-to-hast still honours the
 * `data.hName`/`hChildren` and emits genuine element nodes — not an opaque raw HTML
 * string. `rehype-mermaid` then finds `<code class="language-mermaid">` and renders
 * it to inline SVG at build time. No client-side JS, no `rehype-raw` (which would
 * mangle the Shiki `{@html}` code blocks).
 */
export default function remarkMermaidBlock() {
	return (tree) => {
		visit(tree, 'code', (node) => {
			if (node.lang !== 'mermaid') return;
			node.type = 'mermaidBlock';
			node.data = {
				hName: 'pre',
				hChildren: [
					{
						type: 'element',
						tagName: 'code',
						properties: { className: ['language-mermaid'] },
						children: [{ type: 'text', value: node.value }]
					}
				]
			};
		});
	};
}
