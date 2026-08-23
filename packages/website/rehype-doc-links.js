import { visit } from 'unist-util-visit';

const GITHUB_BLOB = 'https://github.com/vektornode/selva/blob/main';

/**
 * Rewrite the relative links found in the repo-root docs so they resolve on the
 * marketing site:
 *  - links to another doc under `docs/` (`Foo.md`, `../plugin/Bar.md`) -> `/docs/<slug>`
 *  - any `.md` or other path that resolves OUTSIDE `docs/` (`../packages/...`,
 *    `../CLAUDE.md`) -> GitHub blob URL
 *  - absolute URLs and `#anchors` are left untouched
 *
 * Every relative link is resolved against the SOURCE doc's repo-relative directory
 * (e.g. `docs/getting-started`) so a bare sibling link inside a subfolder keeps its
 * subfolder, and a `.md` file that climbs out of `docs/` is recognised as a repo
 * file rather than a doc route. Slugging mirrors `pathToSlug` in src/lib/docs.ts.
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
 * Resolve `link` against repo-relative `fromDir` (POSIX-style), collapsing `.`/`..`.
 * Returns a repo-root-relative path with no leading slash. A link that climbs above
 * the repo root is clamped at the root (there is nothing sensible above it).
 */
function resolveRepoPath(fromDir, link) {
	const stack = fromDir ? fromDir.split('/').filter(Boolean) : [];
	for (const segment of link.split('/')) {
		if (segment === '' || segment === '.') continue;
		if (segment === '..') stack.pop();
		else stack.push(segment);
	}
	return stack.join('/');
}

/**
 * Source doc's directory relative to the repo root, from the mdsvex vfile.
 * e.g. ".../docs/getting-started/overview.md" -> "docs/getting-started".
 * Returns "docs" for a top-level doc, or null if the path isn't under docs/.
 */
function docDirFromFile(file) {
	// mdsvex stores the source path on `.filename`; unified's own vfile uses
	// `.path`/`.history`. Prefer whichever is populated.
	const full = file?.filename ?? file?.path ?? file?.history?.[file.history.length - 1];
	if (typeof full !== 'string') return null;
	const norm = full.replace(/\\/g, '/');
	const idx = norm.lastIndexOf('/docs/');
	if (idx === -1) return null;
	const rel = norm.slice(idx + 1); // drop leading slash -> "docs/getting-started/overview.md"
	const slash = rel.lastIndexOf('/');
	return slash === -1 ? 'docs' : rel.slice(0, slash);
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
	return (tree, file) => {
		// Repo-relative dir of the source doc, e.g. "docs/getting-started". When the
		// vfile path is unavailable, fall back to treating the doc as top-level.
		const docDir = docDirFromFile(file) ?? 'docs';

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
			const suffix = hash ? `#${hash}` : '';
			const repoPath = resolveRepoPath(docDir, pathPart);

			// A `.md` target still under docs/ becomes a doc route; anything that
			// climbed out of docs/ (a package README, ../CLAUDE.md) or any non-`.md`
			// repo path links to GitHub instead.
			if (/\.md$/.test(pathPart) && repoPath.startsWith('docs/')) {
				const slug = toSlug(repoPath.slice('docs/'.length));
				node.properties.href = `/docs/${slug}${suffix}`;
				return;
			}

			node.properties.href = `${GITHUB_BLOB}/${repoPath}${suffix}`;
			openInNewTab(node);
		});
	};
}
