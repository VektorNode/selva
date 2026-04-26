/**
 * M5 — `/api/files/[...path]` is locked to `definitions/{guid}/cover.{ext}`
 * and gated by `requireCanViewProject`. The original implementation was an
 * extension-allowlist open proxy; these tests pin the new contract so a
 * future refactor can't quietly re-open it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { definitionPaths } from '@selva/platform';
import {
	freshProviders,
	seedAcme,
	seedBigClient,
	seedDefinition,
	actAs,
	call,
	type TestProviders
} from '$lib/server/__tests__/fixtures.js';
import { GET } from '../+server.js';

let tp: TestProviders | null = null;

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

/**
 * Canonical 67-byte PNG (1×1 transparent). The storage layer transcodes
 * images to WebP on put (sharp pipeline), so a real PNG goes in and a real
 * WebP lands at the matching `.webp` path. Reusing the same fixture as
 * the storage conformance suite — sharp rejects the truncated WebP fixtures
 * a hand-written test would otherwise use.
 */
const TINY_PNG = Uint8Array.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
	0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
	0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
	0x42, 0x60, 0x82
]);

async function seedCover(tp: TestProviders, guid: string): Promise<void> {
	// Put as PNG — the transcoder rewrites the path to `.webp` and the bytes
	// to a real WebP, landing at exactly `definitionPaths.image(guid)`.
	const pngPath = definitionPaths.image(guid).replace(/\.webp$/, '.png');
	await tp.config.storage.put(pngPath, TINY_PNG, 'image/png');
}

describe('GET /api/files/[...path] — path shape gate', () => {
	it.each([
		// Anything that isn't `definitions/{guid}/cover.{ext}` 404s — even if
		// the extension is on the legacy allowlist.
		['definitions/abc/versions/v1.gh', 'version blob'],
		['definitions/abc/cover.gh', 'wrong extension'],
		['definitions/abc/cover.svg', 'extension not in allowlist'],
		['../etc/passwd', 'path traversal'],
		['random/file.webp', 'not under definitions/'],
		['definitions/not-a-uuid/cover.webp', 'invalid guid'],
		['definitions/00000000-0000-0000-0000-000000000000/cover.webp.evil.webp', 'suffix injection']
	])('rejects %j with 404 (%s)', async (path) => {
		tp = await freshProviders();
		const { alice } = await seedAcme(tp);
		const aliceLocals = await actAs(tp, alice.id);

		const res = await call(GET, {
			locals: aliceLocals,
			params: { path }
		});
		expect(res.status).toBe(404);
	});
});

describe('GET /api/files/[...path] — per-resource authorization', () => {
	it('owner can fetch their own definition cover', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		await seedCover(tp, def.record.guid);

		const aliceLocals = await actAs(tp, alice.id);
		const res = await call(GET, {
			locals: aliceLocals,
			params: { path: `definitions/${def.record.guid}/cover.webp` }
		});
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/webp');
		expect(res.headers.get('cache-control')).toContain('private');
	});

	it("blocks a member of a different org from fetching another tenant's cover", async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		const { carol } = await seedBigClient(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		await seedCover(tp, def.record.guid);

		const carolLocals = await actAs(tp, carol.id);
		const res = await call(GET, {
			locals: carolLocals,
			params: { path: `definitions/${def.record.guid}/cover.webp` }
		});
		expect(res.status).toBe(403);
	});

	it("blocks a same-org member who isn't a project member (private project)", async () => {
		tp = await freshProviders();
		const { alice, bob, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		await seedCover(tp, def.record.guid);

		// Bob is in Acme but not a member of Alice's private project.
		const bobLocals = await actAs(tp, bob.id);
		const res = await call(GET, {
			locals: bobLocals,
			params: { path: `definitions/${def.record.guid}/cover.webp` }
		});
		expect(res.status).toBe(403);
	});

	it('returns 404 for a well-formed but unknown definition guid', async () => {
		tp = await freshProviders();
		const { alice } = await seedAcme(tp);
		const aliceLocals = await actAs(tp, alice.id);

		const res = await call(GET, {
			locals: aliceLocals,
			params: { path: `definitions/00000000-0000-0000-0000-000000000000/cover.webp` }
		});
		expect(res.status).toBe(404);
	});
});
