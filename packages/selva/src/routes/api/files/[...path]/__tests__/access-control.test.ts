/**
 * `/api/files/[...path]` serves only registered asset classes, and a cover only
 * to a caller who can view its definition. These pin that contract so a
 * refactor can't quietly turn it back into an open proxy.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { definitionPaths, orgPaths } from '@selvajs/platform';
import {
	freshProviders,
	seedAcme,
	seedBigClient,
	seedDefinition,
	actAs,
	anon,
	call,
	type TestProviders
} from '#lib/server/__tests__/fixtures.js';
import { GET } from '../+server.js';

let tp: TestProviders | null = null;

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

/**
 * Real 1×1 transparent PNG (91 bytes), emitted by sharp itself. The storage
 * layer transcodes images to WebP on put (sharp pipeline), so a real PNG goes
 * in and a real WebP lands at the matching `.webp` path.
 *
 * Every chunk CRC here is correct. Don't hand-assemble or hand-tweak these
 * bytes — the previous fixture had a bad IDAT CRC (four bytes short), which
 * libpng rejects outright with "vipspng: libpng read error", failing these
 * tests long before they reach the authorization assertions they exist for.
 * The storage conformance suite hit the identical trap; see the note in
 * `storageProviderSuite.ts`. Regenerate with sharp if it ever needs to change.
 */
const TINY_PNG = Uint8Array.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
	0x89, 0x00, 0x00, 0x00, 0x09, 0x70, 0x48, 0x59, 0x73, 0x00, 0x00, 0x03, 0xe8, 0x00, 0x00, 0x03,
	0xe8, 0x01, 0xb5, 0x7b, 0x52, 0x6b, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7,
	0x63, 0x60, 0x60, 0x60, 0x60, 0x00, 0x00, 0x00, 0x05, 0x00, 0x01, 0x5e, 0xf3, 0x2a, 0x3a, 0x00,
	0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
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
		['definitions/00000000-0000-0000-0000-000000000000/cover.webp.evil.webp', 'suffix injection'],
		// Traversal/empty segments must not classify even though the segment
		// alphabet would otherwise admit `..` — `hasUnsafeSegment` rejects them
		// before any class match, so they 404 (never reach auth or storage).
		['orgs/../branding/logo.webp', 'dotdot as orgId (branding)'],
		['orgs/../private/pricing.pdf', 'dotdot as orgId (org-private)'],
		['orgs/abc/private/../branding/logo.webp', 'mid-path traversal'],
		['orgs//branding/logo.webp', 'empty segment']
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

	it("answers 404 to a member of a different org asking for another tenant's cover", async () => {
		// The same answer as an unknown guid: a 403 would confirm the definition exists.
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
		expect(res.status).toBe(404);
	});

	it('answers 401 to an anonymous caller asking for a cover', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		await seedCover(tp, def.record.guid);

		const res = await call(GET, {
			locals: anon(tp),
			params: { path: `definitions/${def.record.guid}/cover.webp` }
		});
		expect(res.status).toBe(401);
	});

	it("answers 404 to a same-org member who isn't a project member (private project)", async () => {
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
		expect(res.status).toBe(404);
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

// ============================================================================
// Org branding — public asset class. Logos must serve to anyone, including
// logged-out visitors (viewer header, login page).
// ============================================================================

describe('GET /api/files/[...path] — org branding (public)', () => {
	it('serves a logo to an anonymous (logged-out) caller', async () => {
		tp = await freshProviders();
		const { acme } = await seedAcme(tp);
		// Branding is stored as `.webp`; put a real WebP at the branding path by
		// uploading a PNG and letting the transcoder rewrite the extension —
		// same trick as `seedCover`.
		const webpPath = orgPaths.asset(acme.id, 'logo');
		const pngPath = webpPath.replace(/\.webp$/, '.png');
		await tp.config.storage.put(pngPath, TINY_PNG, 'image/png');

		const res = await call(GET, {
			locals: anon(tp),
			params: { path: webpPath }
		});
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/webp');
		// Public, not private — branding is CDN-cacheable.
		expect(res.headers.get('cache-control')).toContain('public');
	});

	it('404s a branding path with an unregistered kind', async () => {
		tp = await freshProviders();
		const { acme } = await seedAcme(tp);
		const res = await call(GET, {
			locals: anon(tp),
			params: { path: `orgs/${acme.id}/branding/banner.webp` }
		});
		expect(res.status).toBe(404);
	});
});

describe('GET /api/files/[...path] — orgs/{id}/private', () => {
	it('has no asset class, so even a member gets 404', async () => {
		tp = await freshProviders();
		const { acme, bob } = await seedAcme(tp);
		const path = `orgs/${acme.id}/private/pricing.pdf`;
		await tp.config.storage.put(path, new TextEncoder().encode('PRICES'), 'application/pdf');

		const res = await call(GET, { locals: await actAs(tp, bob.id), params: { path } });

		expect(res.status).toBe(404);
	});
});
