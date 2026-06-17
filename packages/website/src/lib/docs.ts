// Docs loader. The canonical docs live in the repo-root `docs/` folder and are
// the single source of truth — this module globs them, keeps only the ones
// marked `published: true`, and derives slugs + a grouped sidebar from the
// file paths and frontmatter. To publish a doc, add `published: true` to its
// frontmatter; internal docs (ADRs, testing notes) stay private by default.

import type { Component } from 'svelte';

interface DocFrontmatter {
	title?: string;
	/** Opt-in flag — only `true` docs are exposed on the public site. */
	published?: boolean;
	/** Sidebar group, e.g. "Getting Started". Defaults to "Docs". */
	group?: string;
	/** Sort order within a group (lower first). Defaults to 0. */
	order?: number;
}

interface DocModule {
	default: Component;
	metadata?: DocFrontmatter;
}

export interface DocEntry {
	slug: string;
	title: string;
	group: string;
	order: number;
	load: () => Promise<DocModule>;
}

export interface DocSidebarGroup {
	title: string;
	links: { label: string; href: string }[];
}

// Glob the repo-root docs folder. Lazy so each route only pulls its own doc.
const modules = import.meta.glob<DocModule>('/../../docs/**/*.md');
// Eager metadata-only import so we can build the sidebar without loading bodies.
const eager = import.meta.glob<DocModule>('/../../docs/**/*.md', { eager: true });

function pathToSlug(path: string): string {
	// "/../../docs/deployment/GCE-Linux.md" -> "deployment/gce-linux"
	const rel = path.replace(/^.*\/docs\//, '').replace(/\.md$/, '');
	return rel
		.split('/')
		.map((segment) => segment.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase())
		.join('/');
}

function titleFromSlug(slug: string): string {
	const last = slug.split('/').pop() ?? slug;
	return last
		.split('-')
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ');
}

/** All published docs, keyed by slug. */
export const docs: DocEntry[] = Object.entries(modules)
	.map(([path, load]) => {
		const meta = eager[path]?.metadata ?? {};
		const slug = pathToSlug(path);
		return {
			slug,
			title: meta.title ?? titleFromSlug(slug),
			group: meta.group ?? 'Docs',
			order: meta.order ?? 0,
			published: meta.published === true,
			load
		};
	})
	.filter((d) => d.published)
	.map(({ published: _published, ...d }) => d);

export function getDoc(slug: string): DocEntry | undefined {
	return docs.find((d) => d.slug === slug);
}

/** Grouped, ordered sidebar built from published docs. */
export function getDocsSidebar(): DocSidebarGroup[] {
	const groups = new Map<string, DocEntry[]>();
	for (const doc of docs) {
		const list = groups.get(doc.group) ?? [];
		list.push(doc);
		groups.set(doc.group, list);
	}

	return [...groups.entries()].map(([title, entries]) => ({
		title,
		links: entries
			.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
			.map((d) => ({ label: d.title, href: `/docs/${d.slug}` }))
	}));
}
