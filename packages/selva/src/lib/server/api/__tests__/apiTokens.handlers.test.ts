/**
 * Mint, list and revoke through the real routes, then use the minted key.
 *
 * The round trip is the point: a key that mints fine but doesn't resolve, or
 * that still resolves after revoke, passes every narrower test.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { emptyProfile, SYSTEM_CONTEXT } from '@selvajs/platform';
import { resolveApiToken } from '@selvajs/server/http';
import {
	freshProviders,
	seedAcme,
	grantPlatformPermissions,
	actAs,
	call,
	silentLog,
	type TestProviders
} from '../../__tests__/fixtures.js';
import { apiTokenCodec } from '../../apiTokens/token.server.js';
import {
	GET as listTokens,
	POST as mintToken
} from '../../../../routes/api/v1/orgs/[orgId]/tokens/+server.js';
import { DELETE as revokeToken } from '../../../../routes/api/v1/orgs/[orgId]/tokens/[tokenId]/+server.js';
import { GET as listProjects } from '../../../../routes/api/v1/projects/+server.js';

let tp: TestProviders;

afterEach(async () => {
	await tp?.cleanup();
});

const body = (overrides: Record<string, unknown> = {}) => ({
	name: 'CI',
	scopes: ['read:all'],
	expiresInDays: 30,
	...overrides
});

async function keyLocals(raw: string, path = '/api/v1/projects') {
	// The resolver records use in the background; that write would race the
	// temp-dir cleanup after each test.
	vi.spyOn(tp.config.data.apiTokens!, 'touchLastUsed').mockResolvedValue();
	const result = await resolveApiToken(
		new Request(`http://selva.test${path}`, { headers: { authorization: `Bearer ${raw}` } }),
		{ codec: apiTokenCodec(), auth: tp.config.auth, data: tp.config.data }
	);
	return result.kind === 'ok'
		? {
				user: result.user,
				ctx: result.ctx,
				profile: emptyProfile(result.user.id),
				providers: tp.config,
				log: silentLog
			}
		: result;
}

describe('API token endpoints', () => {
	it('mints a key that works, lists it, revokes it, and the key stops working', async () => {
		tp = await freshProviders();
		const { alice, acme } = await seedAcme(tp);
		await grantPlatformPermissions(tp, alice.id, ['manage_api_tokens']);
		const locals = await actAs(tp, alice.id);
		const params = { orgId: acme.id };

		const minted = await call(mintToken, { locals, params, body: body() });
		expect(minted.status).toBe(201);
		expect(minted.headers.get('cache-control')).toBe('no-store');
		const { token, secret } = minted.json as { token: { id: string }; secret: string };
		expect(secret).toMatch(/^selva_/);
		expect(minted.json).not.toHaveProperty('token.tokenHash');

		const keyed = await keyLocals(secret);
		expect((await call(listProjects, { locals: keyed })).status).toBe(200);

		const listed = await call(listTokens, { locals, params });
		expect((listed.json as { items: { id: string }[] }).items.map((t) => t.id)).toEqual([token.id]);

		const revoked = await call(revokeToken, { locals, params: { ...params, tokenId: token.id } });
		expect(revoked.status).toBe(204);
		expect(await keyLocals(secret)).toMatchObject({ kind: 'rejected', status: 401 });
	});

	it('needs manage_api_tokens to mint', async () => {
		tp = await freshProviders();
		const { bob, acme } = await seedAcme(tp);
		const res = await call(mintToken, {
			locals: await actAs(tp, bob.id),
			params: { orgId: acme.id },
			body: body()
		});
		expect(res.status).toBe(403);
	});

	it('refuses a key managing keys', async () => {
		tp = await freshProviders();
		const { alice, acme } = await seedAcme(tp);
		await grantPlatformPermissions(tp, alice.id, ['manage_api_tokens']);
		const minted = await call(mintToken, {
			locals: await actAs(tp, alice.id),
			params: { orgId: acme.id },
			body: body({ scopes: ['write:all'] })
		});
		const keyed = await keyLocals((minted.json as { secret: string }).secret);

		const res = await call(mintToken, { locals: keyed, params: { orgId: acme.id }, body: body() });
		expect(res.status).toBe(403);
	});

	it('refuses to mint while delegated sessions are broken', async () => {
		tp = await freshProviders();
		const { alice, acme } = await seedAcme(tp);
		await grantPlatformPermissions(tp, alice.id, ['manage_api_tokens']);
		Object.assign(tp.config.auth, {
			delegatedSession: {
				status: async () => ({ ok: false, message: 'bad key' }),
				mint: async () => {
					throw new Error('unreachable');
				}
			}
		});
		const res = await call(mintToken, {
			locals: await actAs(tp, alice.id),
			params: { orgId: acme.id },
			body: body()
		});
		expect(res.status).toBe(503);
		expect((await tp.config.data.apiTokens!.listByOrg(SYSTEM_CONTEXT, acme.id)).items).toEqual([]);
	});

	it.each([
		['an unknown scope', { scopes: ['admin:all'] }],
		['no scopes', { scopes: [] }],
		['an unoffered lifetime', { expiresInDays: 365 }],
		['another org', { scopes: ['read:org:not-this-org'] }],
		['a missing project', { scopes: ['read:project:nope'] }]
	])('rejects %s with 400', async (_label, overrides) => {
		tp = await freshProviders();
		const { alice, acme } = await seedAcme(tp);
		await grantPlatformPermissions(tp, alice.id, ['manage_api_tokens']);
		const res = await call(mintToken, {
			locals: await actAs(tp, alice.id),
			params: { orgId: acme.id },
			body: body(overrides)
		});
		expect(res.status).toBe(400);
	});

	it('hides another member’s token from a plain member and lets an admin revoke it', async () => {
		tp = await freshProviders();
		const { alice, bob, acme } = await seedAcme(tp);
		await grantPlatformPermissions(tp, bob.id, ['manage_api_tokens']);
		const params = { orgId: acme.id };
		const minted = await call(mintToken, {
			locals: await actAs(tp, bob.id),
			params,
			body: body()
		});
		const tokenId = (minted.json as { token: { id: string } }).token.id;

		// Alice (admin) sees it on the roster and revokes it, audited as `admin`.
		const aliceLocals = await actAs(tp, alice.id);
		const roster = await call(listTokens, {
			locals: aliceLocals,
			params,
			url: 'http://test.local/?all=true'
		});
		expect((roster.json as { items: { id: string }[] }).items.map((t) => t.id)).toContain(tokenId);
		const res = await call(revokeToken, { locals: aliceLocals, params: { ...params, tokenId } });
		expect(res.status).toBe(204);
		expect((await tp.config.data.apiTokens!.get(SYSTEM_CONTEXT, tokenId))?.revokedAt).toBeTruthy();
	});

	it('gives a plain member 404 on someone else’s token and 403 on the roster', async () => {
		tp = await freshProviders();
		const { alice, bob, acme } = await seedAcme(tp);
		await grantPlatformPermissions(tp, alice.id, ['manage_api_tokens']);
		const params = { orgId: acme.id };
		const minted = await call(mintToken, {
			locals: await actAs(tp, alice.id),
			params,
			body: body()
		});
		const tokenId = (minted.json as { token: { id: string } }).token.id;

		const bobLocals = await actAs(tp, bob.id);
		expect(
			(await call(revokeToken, { locals: bobLocals, params: { ...params, tokenId } })).status
		).toBe(404);
		expect(
			(await call(listTokens, { locals: bobLocals, params, url: 'http://test.local/?all=true' }))
				.status
		).toBe(403);
	});
});
