import { visit } from 'unist-util-visit';

const GITHUB_BLOB = 'https://github.com/vektornode/selva/blob/main';

/**
 * Rewrite the relative links found in the repo-root docs so they resolve on the
 * marketing site:
 *  - links to another doc (`Foo.md`, `./deployment/Bar.md`) -> `/docs/<slug>`
 *  - any other repo-relative path (`../packages/...`) -> GitHub blob URL
 *  - absolute URLs and `#anchors` are left untouched
 *
 * Slugging here mirrors `pathToSlug` in src/lib/docs.ts.
 */
function toSlug(path) {
	return path
		.replace(/\.md$/, '')
		.split('/')
		.filter((s) => s && s !== '.')
		.map((s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase())
		.join('/');
}

/**
 * When a link's visible text is just the target filename (e.g. `RhinoCompute.md`),
 * humanize it: drop the `.md` and split CamelCase into words. Authors write these
 * filename labels so the links also work on GitHub; on the site we render nicely.
 */
function humanizeFilenameLabel(node) {
	if (node.children?.length !== 1) return;
	const child = node.children[0];
	if (child.type !== 'text') return;
	const text = child.value.trim();
	if (!/^[\w./-]+\.md$/.test(text)) return;

	const base = text.replace(/^.*\//, '').replace(/\.md$/, '');
	child.value = base.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

/** Make a link open in a new tab, safely. */
function openInNewTab(node) {
	node.properties.target = '_blank';
	node.properties.rel = 'noreferrer';
}

export default function rehypeDocLinks() {
	return (tree) => {
		visit(tree, 'element', (node) => {
			if (node.tagName !== 'a') return;
			const href = node.properties?.href;
			if (typeof href !== 'string') return;

			humanizeFilenameLabel(node);

			// Existing absolute http(s) links are external — open in a new tab.
			if (/^https?:/.test(href)) {
				openInNewTab(node);
				return;
			}

			// Anchors and mailto stay in place.
			if (/^(mailto:|#|\/)/.test(href)) return;

			const [pathPart, hash = ''] = href.split('#');

			// Sibling/relative .md links resolve to doc routes. Strip leading
			// `./` and `../` segments — docs are flattened under /docs/<slug>.
			if (/\.md$/.test(pathPart)) {
				const cleaned = pathPart.replace(/^(\.\.?\/)+/, '');
				node.properties.href = `/docs/${toSlug(cleaned)}${hash ? `#${hash}` : ''}`;
				return;
			}

			// Everything else points at repo files — link to GitHub in a new tab.
			const cleaned = pathPart.replace(/^(\.\.?\/)+/, '');
			node.properties.href = `${GITHUB_BLOB}/${cleaned}${hash ? `#${hash}` : ''}`;
			openInNewTab(node);
		});
	};
}
