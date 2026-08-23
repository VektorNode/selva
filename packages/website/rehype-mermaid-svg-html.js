import { visit } from 'unist-util-visit';
import { toHtml } from 'hast-util-to-html';

/**
 * Wrap rehype-mermaid's inline `<svg>` output in a Svelte `{@html `…`}` raw node.
 * Mermaid embeds a `<style>` element whose CSS contains curly braces; left inline,
 * Svelte's compiler treats those as expression delimiters and fails to parse the
 * doc. Serialising the SVG and emitting it through `{@html}` (the same trick the
 * Shiki highlighter uses) makes Svelte pass it through verbatim. Runs after
 * rehypeMermaid.
 */
export default function rehypeMermaidSvgHtml() {
	return (tree) => {
		visit(tree, 'element', (node, index, parent) => {
			if (node.tagName !== 'svg' || !parent || index === null) return;
			const svg = toHtml(node).replace(/\\/g, '\\\\').replace(/`/g, '\\`');
			parent.children[index] = { type: 'raw', value: `{@html \`${svg}\`}` };
			return ['skip'];
		});
	};
}
