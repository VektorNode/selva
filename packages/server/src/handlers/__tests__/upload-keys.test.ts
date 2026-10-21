/**
 * Keys that only read and upload: who may hold one, what the listings tell
 * its holder, finding a definition by its Grasshopper document, and a key
 * revoking itself.
 */

import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { SYSTEM_CONTEXT, type ProjectRole } from '@selvajs/platform';
import { freshHarness, type HandlerHarness } from '../../__tests__/local-harness.js';
import {
	actAs,
	callHandler,
	grantPlatformPermissions,
	seedAcme,
	seedAcmeDesigner,
	seedBigClient,
	seedDefinition,
	seedOrgMember,
	seedUser,
	type ActingLocals,
	type AcmeFixture
} from '../../testing/index.js';
import type { ApiRequest } from '../../api/index.js';
import { createApiTokenCodec } from '../../tokens/index.js';
import { resolveApiToken } from '../../http/index.js';
import { createApiToken, listApiTokens, revokeApiToken, revokeOwnApiToken } from '../apiTokens.js';
import { listProjects } from '../projects.js';
import { getDefinition, listDefinitions } from '../definitions.js';
import { consentOrgs, mintConsentToken } from '../oauthConsent.js';

const codec = createApiTokenCodec('k'.repeat(32));

let h: HandlerHarness | null = null;

afterEach(async () => {
	vi.restoreAllMocks();
	await h?.cleanup();
	h = null;
});

interface World extends AcmeFixture {
	h: HandlerHarness;
	/** An org member who edits one project and holds no platform permission. */
	dana: { id: string };
}

async function world(): Promise<World> {
	h = await freshHarness();
	h.deps = { ...h.deps, tokens: { ...h.deps?.tokens, apiTokens: codec } };
	const acme = await seedAcme(h);
	return { ...acme, h, dana: await seedAcmeDesigner(h, acme) };
}

function mint(locals: ActingLocals, orgId: string, scopes: string[]) {
	return callHandler(createApiToken, {
		locals,
		params: { orgId },
		body: { name: 'plugin', scopes, expiresInDays: 30 }
	});
}

async function mintedSecret(w: World, userId: string, scopes: string[]): Promise<string> {
	const res = await mint(await actAs(w.h, userId), w.acme.id, scopes);
	expect(res.status).toBe(201);
	return (res.json as { secret: string }).secret;
}

function resolve(w: World, raw: string) {
	// The background lastUsedAt write would race the temp-dir cleanup.
	vi.spyOn(w.h.config.data.apiTokens!, 'touchLastUsed').mockResolvedValue();
	return resolveApiToken(
		new Request('http://selva.test/api/v1/projects', {
			headers: { authorization: `Bearer ${raw}` }
		}),
		{ codec, auth: w.h.config.auth, data: w.h.config.data }
	);
}

/** What a request carrying `raw` sees: the owner's locals with the key's narrowed context. */
async function asKey(w: World, raw: string): Promise<ActingLocals> {
	const result = await resolve(w, raw);
	if (result.kind !== 'ok') throw new Error(`key rejected: ${JSON.stringify(result)}`);
	return { ...(await actAs(w.h, result.user.id)), ctx: result.ctx };
}

async function setRole(w: World, projectId: string, userId: string, role: ProjectRole) {
	await w.h.config.data.projects.updateProjectMemberRole(SYSTEM_CONTEXT, projectId, userId, role);
}

// ============================================================================
// Holding
// ============================================================================

describe('who may hold a key that only reads and uploads', () => {
	it('anyone who can create a definition in the org, without manage_api_tokens', async () => {
		const w = await world();
		const locals = await actAs(w.h, w.dana.id);
		for (const scopes of [['upload:all'], ['read:all'], ['read:all', 'upload:all']]) {
			expect((await mint(locals, w.acme.id, scopes)).status).toBe(201);
		}
	});

	it('not someone who can create a definition nowhere in the org', async () => {
		const w = await world();
		const res = await mint(await actAs(w.h, w.bob.id), w.acme.id, ['upload:all']);
		expect(res.status).toBe(403);
	});

	it('anything broader still needs manage_api_tokens', async () => {
		const w = await world();
		const locals = await actAs(w.h, w.dana.id);
		for (const scopes of [['write:all'], ['solve:all'], ['upload:all', 'solve:all']]) {
			expect((await mint(locals, w.acme.id, scopes)).status).toBe(403);
		}
		await grantPlatformPermissions(w.h, w.dana.id, ['manage_api_tokens']);
		expect((await mint(await actAs(w.h, w.dana.id), w.acme.id, ['write:all'])).status).toBe(201);
	});

	it('lists and revokes their own keys, and no one else’s', async () => {
		const w = await world();
		await mintedSecret(w, w.dana.id, ['upload:all']);
		await grantPlatformPermissions(w.h, w.alice.id, ['manage_api_tokens']);
		await mintedSecret(w, w.alice.id, ['write:all']);
		const locals = await actAs(w.h, w.dana.id);
		const params = { orgId: w.acme.id };

		const mine = await callHandler(listApiTokens, { locals, params });
		const rows = (mine.json as { items: { id: string; userId: string }[] }).items;
		expect(rows.map((t) => t.userId)).toEqual([w.dana.id]);

		const roster = await callHandler(listApiTokens, {
			locals,
			params,
			url: 'http://test.local/?all=true'
		});
		expect(roster.status).toBe(403);

		const all = await w.h.config.data.apiTokens!.listByOrg(SYSTEM_CONTEXT, w.acme.id);
		const alices = all.items.find((t) => t.userId === w.alice.id)!;
		const theirs = await callHandler(revokeApiToken, {
			locals,
			params: { ...params, tokenId: alices.id },
			method: 'DELETE'
		});
		expect(theirs.status).toBe(404);

		const own = await callHandler(revokeApiToken, {
			locals,
			params: { ...params, tokenId: rows[0]!.id },
			method: 'DELETE'
		});
		expect(own.status).toBe(204);
	});

	it('stops a key working when its owner loses their last editable project', async () => {
		const w = await world();
		const raw = await mintedSecret(w, w.dana.id, ['upload:all']);
		expect((await resolve(w, raw)).kind).toBe('ok');

		await setRole(w, w.acmeOrg.id, w.dana.id, 'viewer');
		expect(await resolve(w, raw)).toMatchObject({
			kind: 'rejected',
			status: 403,
			code: 'API_TOKEN_HOLDER_REFUSED'
		});

		await setRole(w, w.acmeOrg.id, w.dana.id, 'editor');
		expect((await resolve(w, raw)).kind).toBe('ok');
	});
});

// ============================================================================
// Write rights in listings
// ============================================================================

describe('canCreateDefinitions on GET /projects', () => {
	async function flags(locals: ActingLocals) {
		const res = await callHandler(listProjects, { locals });
		expect(res.status).toBe(200);
		const items = (res.json as { items: { id: string; canCreateDefinitions: boolean }[] }).items;
		return Object.fromEntries(items.map((p) => [p.id, p.canCreateDefinitions]));
	}

	it('follows the create rule for a session', async () => {
		const w = await world();
		expect(await flags(await actAs(w.h, w.dana.id))).toEqual({
			[w.acmeOrg.id]: true,
			[w.acmePublic.id]: false
		});
	});

	it('reflects the key’s scope for a token', async () => {
		const w = await world();
		const upload = await asKey(w, await mintedSecret(w, w.dana.id, ['upload:all']));
		expect((await flags(upload))[w.acmeOrg.id]).toBe(true);

		const read = await asKey(w, await mintedSecret(w, w.dana.id, ['read:all']));
		expect(Object.values(await flags(read))).toEqual([false, false]);
	});
});

describe('canEdit on GET /definitions/{guid}', () => {
	async function canEdit(locals: ActingLocals, guid: string) {
		const res = await callHandler(getDefinition, { locals, params: { guid } });
		expect(res.status).toBe(200);
		return (res.json as { canEdit: boolean }).canEdit;
	}

	it('is true for an editor, false for someone who can only view', async () => {
		const w = await world();
		const { record } = await seedDefinition(w.h, { projectId: w.acmeOrg.id, ownerId: w.alice.id });
		expect(await canEdit(await actAs(w.h, w.dana.id), record.guid)).toBe(true);
		expect(await canEdit(await actAs(w.h, w.bob.id), record.guid)).toBe(false);
	});

	it('needs the upload scope for a token', async () => {
		const w = await world();
		const { record } = await seedDefinition(w.h, { projectId: w.acmeOrg.id, ownerId: w.alice.id });
		const upload = await asKey(w, await mintedSecret(w, w.dana.id, ['upload:all']));
		const read = await asKey(w, await mintedSecret(w, w.dana.id, ['read:all']));
		expect(await canEdit(upload, record.guid)).toBe(true);
		expect(await canEdit(read, record.guid)).toBe(false);
	});
});

// ============================================================================
// documentId
// ============================================================================

describe('GET /definitions?documentId=', () => {
	async function find(locals: ActingLocals, documentId: string) {
		const url = `http://test.local/api/v1/definitions?documentId=${encodeURIComponent(documentId)}`;
		return callHandler(listDefinitions, { locals, url });
	}

	async function seeded(w: World) {
		const doc = randomUUID();
		const inOrgProject = await seedDefinition(w.h, {
			projectId: w.acmeOrg.id,
			ownerId: w.alice.id,
			documentId: doc.toUpperCase()
		});
		const inPrivate = await seedDefinition(w.h, {
			projectId: w.alicesPrivate.id,
			ownerId: w.alice.id,
			documentId: doc
		});
		const otherDoc = await seedDefinition(w.h, {
			projectId: w.acmeOrg.id,
			ownerId: w.alice.id,
			documentId: randomUUID()
		});
		return { doc, inOrgProject, inPrivate, otherDoc };
	}

	const guids = (res: { json?: unknown }) =>
		(res.json as { items: { guid: string }[] }).items.map((d) => d.guid).sort();

	it('returns only definitions from that document the caller can upload to', async () => {
		const w = await world();
		const { doc, inOrgProject, inPrivate } = await seeded(w);

		expect(guids(await find(await actAs(w.h, w.alice.id), doc))).toEqual(
			[inOrgProject.record.guid, inPrivate.record.guid].sort()
		);
		expect(guids(await find(await actAs(w.h, w.dana.id), doc.toUpperCase()))).toEqual([
			inOrgProject.record.guid
		]);
		// Bob can see the org project's definition but can't edit it.
		expect(guids(await find(await actAs(w.h, w.bob.id), doc))).toEqual([]);
	});

	it('gives a read-only key nothing, and an upload key what its owner can edit', async () => {
		const w = await world();
		const { doc, inOrgProject } = await seeded(w);
		const read = await asKey(w, await mintedSecret(w, w.dana.id, ['read:all']));
		const upload = await asKey(w, await mintedSecret(w, w.dana.id, ['upload:all']));
		expect(guids(await find(read, doc))).toEqual([]);
		expect(guids(await find(upload, doc))).toEqual([inOrgProject.record.guid]);
	});

	it('carries sourceDocumentId on list items and on the definition', async () => {
		const w = await world();
		const { doc, inOrgProject } = await seeded(w);
		const locals = await actAs(w.h, w.dana.id);
		const listed = await find(locals, doc);
		expect((listed.json as { items: { sourceDocumentId: string }[] }).items).toEqual([
			expect.objectContaining({ sourceDocumentId: doc })
		]);
		const one = await callHandler(getDefinition, {
			locals,
			params: { guid: inOrgProject.record.guid }
		});
		expect(one.json).toMatchObject({ sourceDocumentId: doc });

		const plain = await seedDefinition(w.h, { projectId: w.acmeOrg.id, ownerId: w.alice.id });
		const none = await callHandler(getDefinition, {
			locals,
			params: { guid: plain.record.guid }
		});
		expect((none.json as { sourceDocumentId: unknown }).sourceDocumentId).toBeNull();
	});

	it.each(['not-a-guid', '', '__proto__', `${randomUUID()}x`])(
		'refuses %j with 400',
		async (bad) => {
			const w = await world();
			const res = await find(await actAs(w.h, w.dana.id), bad);
			expect(res.status).toBe(400);
		}
	);

	it('follows the GUID of the latest upload that carried one', async () => {
		const w = await world();
		const service = w.h.definitionService;
		const first = randomUUID();
		const { record } = await seedDefinition(w.h, {
			projectId: w.acmeOrg.id,
			ownerId: w.alice.id,
			documentId: first.toUpperCase()
		});
		expect(record.sourceDocumentId).toBe(first);

		const ctx = (await actAs(w.h, w.alice.id)).ctx;
		const bytes = new TextEncoder().encode('v2');
		const second = randomUUID();
		const schemaWith = (documentId?: string) =>
			({ name: 'Test', inputs: [], outputs: [], documentId }) as never;
		await service.uploadVersion(ctx, record.guid, bytes, 'gh', 'v2.gh', schemaWith(second));
		expect((await w.h.config.data.definitions.get(ctx, record.guid))?.sourceDocumentId).toBe(
			second
		);

		await service.uploadVersion(ctx, record.guid, bytes, 'gh', 'v3.gh', schemaWith(undefined));
		expect((await w.h.config.data.definitions.get(ctx, record.guid))?.sourceDocumentId).toBe(
			second
		);
	});
});

// ============================================================================
// DELETE /me/token
// ============================================================================

describe('a key revoking itself', () => {
	it('revokes the key that sent the request, which then gets 401', async () => {
		const w = await world();
		const raw = await mintedSecret(w, w.dana.id, ['upload:all']);
		const other = await mintedSecret(w, w.dana.id, ['upload:all']);
		const res = await callHandler(revokeOwnApiToken, {
			locals: await asKey(w, raw),
			method: 'DELETE',
			mount: { anyScope: true }
		});
		expect(res.status).toBe(204);
		expect(await resolve(w, raw)).toMatchObject({ kind: 'rejected', status: 401 });
		expect((await resolve(w, other)).kind).toBe('ok');
		const [row] = (
			await w.h.config.data.apiTokens!.listByOrg(SYSTEM_CONTEXT, w.acme.id, { userId: w.dana.id })
		).items.filter((t) => t.revokedAt);
		expect(row).toBeDefined();
	});

	it('works for a key scoped to one project, which no org-level route takes', async () => {
		const w = await world();
		await grantPlatformPermissions(w.h, w.alice.id, ['manage_api_tokens']);
		const raw = await mintedSecret(w, w.alice.id, [`read:project:${w.acmeOrg.id}`]);
		const locals = await asKey(w, raw);
		const scoped = await callHandler(revokeOwnApiToken, { locals, method: 'DELETE' });
		expect(scoped.status).toBe(403);
		const open = await callHandler(revokeOwnApiToken, {
			locals,
			method: 'DELETE',
			mount: { anyScope: true }
		});
		expect(open.status).toBe(204);
	});

	it('gives a browser session 400', async () => {
		const w = await world();
		const res = await callHandler(revokeOwnApiToken, {
			locals: await actAs(w.h, w.dana.id),
			method: 'DELETE',
			mount: { anyScope: true }
		});
		expect(res.status).toBe(400);
	});
});

// ============================================================================
// Consent
// ============================================================================

describe('consent in an org the user picks', () => {
	async function twoOrgs() {
		const w = await world();
		const big = await seedBigClient(w.h);
		await seedOrgMember(w.h, { orgId: big.bigClient.id, userId: w.dana.id, role: 'member' });
		return { ...w, big };
	}

	const run = <T>(locals: ActingLocals, fn: (req: ApiRequest) => Promise<T>) =>
		callHandler(async (req) => ({ body: await fn(req) }), { locals });

	it('offers only the orgs where the user may hold the key', async () => {
		const w = await twoOrgs();
		const locals = await actAs(w.h, w.dana.id);
		const upload = await run(locals, (req) => consentOrgs(req, ['upload:all']));
		expect(upload.json).toEqual([{ id: w.acme.id, name: 'Acme' }]);

		await grantPlatformPermissions(w.h, w.dana.id, ['manage_api_tokens']);
		const broad = await run(await actAs(w.h, w.dana.id), (req) => consentOrgs(req, ['upload:all']));
		expect((broad.json as { id: string }[]).map((o) => o.id).sort()).toEqual(
			[w.acme.id, w.big.bigClient.id].sort()
		);
	});

	it('mints in the picked org, not the session’s', async () => {
		const w = await twoOrgs();
		await grantPlatformPermissions(w.h, w.dana.id, ['manage_api_tokens']);
		const locals = await actAs(w.h, w.dana.id);
		const picked = locals.ctx.actingOrgId === w.acme.id ? w.big.bigClient.id : w.acme.id;
		const res = await run(locals, (req) =>
			mintConsentToken(req, picked, {
				name: 'Selva for Grasshopper (OAuth)',
				scopes: ['upload:all'],
				expiresInDays: 30
			})
		);
		expect(res.status).toBe(200);
		expect(res.json).toMatchObject({ token: { orgId: picked, scopes: ['upload:all'] } });
	});

	it('refuses an org the user doesn’t belong to', async () => {
		const w = await twoOrgs();
		const outsider = await seedUser(w.h, 'olga@elsewhere.test');
		await seedOrgMember(w.h, { orgId: w.acme.id, userId: outsider.id, role: 'admin' });
		await grantPlatformPermissions(w.h, outsider.id, ['manage_api_tokens']);
		for (const orgId of [w.big.bigClient.id, '', 'no-such-org']) {
			const res = await run(await actAs(w.h, outsider.id), (req) =>
				mintConsentToken(req, orgId, { name: 'x', scopes: ['read:all'], expiresInDays: 30 })
			);
			expect(res.status).toBe(403);
		}
	});
});
