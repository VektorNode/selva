// Guards the `docs/` tree's shape and its internal links.
//
// Both failure modes this catches are silent: a misfiled doc still renders, it
// just lands in the wrong sidebar group, and a broken relative link only shows
// up when a reader clicks it. Neither breaks the build on its own.
//
// The invariant: every doc lives at `audience/group/doc.md`, or at the root if
// it's a shared entry point. `docs.ts` derives the sidebar group from the parent
// folder, so a loose file inside an audience folder has no group to land in.
//
// `contributing/` is exempt from the depth and frontmatter rules: it is repo-only
// prose that never reaches the site, so it has no sidebar group to belong to. Its
// links are still checked — a broken link hurts a contributor just as much.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const DOCS_ROOT = fileURLToPath(new URL('../../../docs/', import.meta.url));

// ADRs are excluded from the website glob entirely, so none of the rules here
// apply to them — they are internal records, not published pages.
const EXCLUDED_DIRS = new Set(['adr']);

// Docs that are the shared entry points, before a reader picks an audience.
const ROOT_DOCS = new Set(['README.md', 'what-is-selva.md', 'architecture.md']);

// Repo-only prose: never published, so no sidebar group and no frontmatter.
const UNPUBLISHED_AUDIENCE = 'contributing/';

function walk(dir: string, base = ''): string[] {
	return readdirSync(dir).flatMap((name) => {
		const rel = base ? `${base}/${name}` : name;
		if (statSync(path.join(dir, name)).isDirectory()) {
			return EXCLUDED_DIRS.has(rel) ? [] : walk(path.join(dir, name), rel);
		}
		return name.endsWith('.md') ? [rel] : [];
	});
}

const allDocs = walk(DOCS_ROOT);

function frontmatter(rel: string): Record<string, string> | null {
	const raw = readFileSync(path.join(DOCS_ROOT, rel), 'utf8');
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return null;
	const out: Record<string, string> = {};
	for (const line of match[1].split(/\r?\n/)) {
		const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
		if (kv) out[kv[1]] = kv[2].trim();
	}
	return out;
}

/** Docs that can reach the site — everything but the root README and repo-only prose. */
const pageDocs = allDocs.filter(
	(rel) => rel !== 'README.md' && !rel.startsWith(UNPUBLISHED_AUDIENCE)
);

describe('docs structure', () => {
	it('places every doc at audience/group/doc.md, or at the root', () => {
		const misfiled = pageDocs.filter((rel) => {
			const depth = rel.split('/').length;
			if (depth === 1) return !ROOT_DOCS.has(rel);
			return depth !== 3;
		});
		expect(misfiled, 'move these into an audience/group/ folder').toEqual([]);
	});

	it('gives every page doc a title and description', () => {
		const missing = pageDocs.filter((rel) => {
			const fm = frontmatter(rel);
			return !fm?.title || !fm?.description;
		});
		expect(missing, 'add title + description frontmatter').toEqual([]);
	});

	it('has no `group:` frontmatter — the folder decides the group', () => {
		const stale = pageDocs.filter((rel) => frontmatter(rel)?.group !== undefined);
		expect(stale, 'remove `group:`; docs.ts derives it from the parent folder').toEqual([]);
	});

	it('marks published intent explicitly', () => {
		const missing = pageDocs.filter((rel) => {
			const published = frontmatter(rel)?.published;
			return published !== 'true' && published !== 'false';
		});
		expect(missing, 'add `published: true` or `published: false`').toEqual([]);
	});
});

describe('docs links', () => {
	it('resolves every relative link to a file that exists', () => {
		const broken: string[] = [];

		for (const rel of allDocs) {
			const raw = readFileSync(path.join(DOCS_ROOT, rel), 'utf8');
			const fromDir = path.dirname(path.join(DOCS_ROOT, rel));

			for (const m of raw.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
				const href = m[1].split(/\s+/)[0];
				// Skip absolute URLs, in-page anchors, and mailto:.
				if (/^(https?:|mailto:|#)/.test(href)) continue;

				const target = href.split('#')[0];
				if (!target) continue;

				const resolved = path.resolve(fromDir, target);
				try {
					statSync(resolved);
				} catch {
					broken.push(`${rel} → ${href}`);
				}
			}
		}

		expect(broken, 'fix or remove these links').toEqual([]);
	});
});
