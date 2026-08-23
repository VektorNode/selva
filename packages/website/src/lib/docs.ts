// Docs loader. The canonical docs live in the repo-root `docs/` folder and are
// the single source of truth — this module globs them, keeps only the ones
// marked `published: true`, and derives slugs + a grouped sidebar from the
// file paths and frontmatter. To publish a doc, add `published: true` to its
// frontmatter; internal docs (ADRs, contributor guides) stay private by default.
//
// Layout is `audience/group/doc.md` — the folder decides the sidebar group, so
// there is no `group:` frontmatter to drift out of sync with the path. Root-level
// docs (what-is-selva, architecture) are the shared entry points and group under
// "Overview". `docs/__tests__/structure.test.ts` enforces the shape.
//
// A published doc's path IS its public URL. Moving one after release needs an
// entry in REDIRECTS below, or the old link breaks.

import type { Component } from 'svelte';

interface DocFrontmatter {
	title?: string;
	/** Opt-in flag — only `true` docs are exposed on the public site. */
	published?: boolean;
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
// `plans/` now lives outside `docs/` entirely (internal-only, not published).
// `adr/` decision records are still under `docs/` but excluded from the glob:
// they're never published, and compiling them would run mdsvex over prose
// that isn't written to be Svelte-safe (e.g. a bare `< 22` parses as a stray
// tag and fails the build). The `published` filter below only gates
// *exposure*; the glob decides what gets *compiled*.
// `docs/README.md` is excluded too: it is the repo-side index, a folder map for
// someone browsing the source tree. The site has its own index at /docs.
//
// Both globs must be written out as literal arrays — Vite analyses the argument
// statically, so hoisting the patterns to a shared const silently matches nothing.
const modules = import.meta.glob<DocModule>([
	'/../../docs/**/*.md',
	'!/../../docs/adr/**',
	'!/../../docs/README.md'
]);
// Eager metadata-only import so we can build the sidebar without loading bodies.
const eager = import.meta.glob<DocModule>(
	['/../../docs/**/*.md', '!/../../docs/adr/**', '!/../../docs/README.md'],
	{ eager: true }
);

/**
 * Old slug → current slug, for docs moved after they were published. Empty
 * until the first such move: nothing has shipped yet, so no public URL exists
 * to preserve. Add an entry here rather than leaving a dead link behind.
 */
const REDIRECTS: Record<string, string> = {};

function pathToSlug(path: string): string {
	// "/../../docs/self-hosting/deployment/prerequisites.md"
	//   -> "self-hosting/deployment/prerequisites"
	return path
		.replace(/^.*\/docs\//, '')
		.replace(/\.md$/, '')
		.toLowerCase();
}

function titleCase(segment: string): string {
	return segment
		.split('-')
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ');
}

function titleFromSlug(slug: string): string {
	return titleCase(slug.split('/').pop() ?? slug);
}

// Sidebar group = the doc's parent folder, title-cased. A root-level doc has no
// parent folder inside `docs/`, so it lands in "Overview" — the shared entry
// points a reader hits before choosing an audience.
function groupFromSlug(slug: string): string {
	const parts = slug.split('/');
	if (parts.length < 2) return 'Overview';
	return titleCase(parts[parts.length - 2]);
}

/** All published docs, keyed by slug. */
export const docs: DocEntry[] = Object.entries(modules)
	.map(([path, load]) => {
		const meta = eager[path]?.metadata ?? {};
		const slug = pathToSlug(path);
		return {
			slug,
			title: meta.title ?? titleFromSlug(slug),
			group: groupFromSlug(slug),
			order: meta.order ?? 0,
			description: meta.description,
			published: meta.published === true,
			load
		};
	})
	.filter((d) => d.published)
	.map(({ published: _published, ...d }) => d);

export function getDoc(slug: string): DocEntry | undefined {
	return docs.find((d) => d.slug === slug) ?? docs.find((d) => d.slug === REDIRECTS[slug]);
}

const eagerSlugs = new Map(Object.entries(eager).map(([path, mod]) => [pathToSlug(path), mod]));

/**
 * Docs that exist on disk but aren't published yet. They get a "not public yet"
 * stub rather than a 404, so a link from a published doc into one still lands
 * somewhere that explains itself. Derived from disk, so publishing a doc removes
 * its stub automatically.
 */
export const unpublishedSlugs: string[] = [...eagerSlugs.entries()]
	.filter(([, mod]) => mod?.metadata?.published !== true)
	.map(([slug]) => slug);

/** Title to show on an unpublished doc's stub page. */
export function getUnpublishedTitle(slug: string): string | undefined {
	const mod = eagerSlugs.get(slug);
	if (!mod || mod.metadata?.published === true) return undefined;
	return mod.metadata?.title ?? titleFromSlug(slug);
}

// Fixed group order for both the sidebar and the docs index. Groups not listed
// here fall to the end, alphabetically. Mirrors the reading order a newcomer
// wants: what it is, then how to run it, then how to build on it.
const GROUP_ORDER = ['Overview', 'Get Started', 'Deployment', 'Providers', 'Concepts', 'Build'];

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

/** Old published slugs that now redirect — prerendered so the URLs keep working. */
export const redirectSlugs: string[] = Object.keys(REDIRECTS);
