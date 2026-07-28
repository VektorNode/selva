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
	/** One-line summary shown on index/overview cards. Optional. */
	description?: string;
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
	description?: string;
	load: () => Promise<DocModule>;
}

export interface DocSidebarGroup {
	title: string;
	links: { label: string; href: string }[];
}

export interface DocIndexGroup {
	title: string;
	entries: DocEntry[];
}

// Glob the repo-root docs folder. Lazy so each route only pulls its own doc.
// Internal-only trees (`plans/` trackers, `adr/` decision records) are excluded
// from the glob entirely: they're never published, and compiling them would run
// mdsvex over prose that isn't written to be Svelte-safe (e.g. a bare `< 22`
// parses as a stray tag and fails the build). The `published` filter below only
// gates *exposure*; the glob decides what gets *compiled*.
const modules = import.meta.glob<DocModule>([
	'/../../docs/**/*.md',
	'!/../../docs/plans/**',
	'!/../../docs/adr/**'
]);
// Eager metadata-only import so we can build the sidebar without loading bodies.
const eager = import.meta.glob<DocModule>(
	['/../../docs/**/*.md', '!/../../docs/plans/**', '!/../../docs/adr/**'],
	{ eager: true }
);

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
			description: meta.description,
			published: meta.published === true,
			load
		};
	})
	.filter((d) => d.published)
	.map(({ published: _published, ...d }) => d);

export function getDoc(slug: string): DocEntry | undefined {
	return docs.find((d) => d.slug === slug);
}

// Fixed group order for both the sidebar and the docs index. Groups not listed
// here fall to the end, alphabetically. Keeps "Get Started" first, reference
// material last, regardless of per-doc `order`.
const GROUP_ORDER = ['Get Started', 'Concepts', 'Plugin', 'Providers', 'Deployment'];

function groupRank(title: string): number {
	const i = GROUP_ORDER.indexOf(title);
	return i === -1 ? GROUP_ORDER.length : i;
}

/** Docs grouped and ordered, the shared basis for the sidebar and index. */
function groupedDocs(): DocIndexGroup[] {
	const groups = new Map<string, DocEntry[]>();
	for (const doc of docs) {
		const list = groups.get(doc.group) ?? [];
		list.push(doc);
		groups.set(doc.group, list);
	}

	return [...groups.entries()]
		.sort(([a], [b]) => groupRank(a) - groupRank(b) || a.localeCompare(b))
		.map(([title, entries]) => ({
			title,
			entries: entries.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
		}));
}

/** Grouped, ordered sidebar built from published docs. */
export function getDocsSidebar(): DocSidebarGroup[] {
	return groupedDocs().map((g) => ({
		title: g.title,
		links: g.entries.map((d) => ({ label: d.title, href: `/docs/${d.slug}` }))
	}));
}

/** Grouped, ordered docs with descriptions — for the /docs index cards. */
export function getDocsIndex(): DocIndexGroup[] {
	return groupedDocs();
}

/** Flat, reading-order list of docs — powers prev/next navigation. */
export function getDocsFlat(): DocEntry[] {
	return groupedDocs().flatMap((g) => g.entries);
}

/** The previous and next doc around a slug, in reading order. */
export function getDocNeighbors(slug: string): { prev?: DocEntry; next?: DocEntry } {
	const flat = getDocsFlat();
	const i = flat.findIndex((d) => d.slug === slug);
	if (i === -1) return {};
	return { prev: flat[i - 1], next: flat[i + 1] };
}
