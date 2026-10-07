/**
 * API tokens end to end on the local provider: a real key, resolved against
 * real stores, driving real v1 routes. Pins the resolution invariants a broken
 * hook or a forgotten scope check would silently break.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SYSTEM_CONTEXT, emptyProfile } from '@selvajs/platform';
import { resolveApiToken } from '@selvajs/server/http';
import { createApiTokenCodec } from '@selvajs/server/tokens';
import {
	freshProviders,
	seedAcme,
	grantPlatformPermissions,
	call,
	silentLog,
	type TestProviders
} from './fixtures.js';
import { GET, POST } from '../../../routes/api/v1/projects/+server.js';
import { GET as getProject } from '../../../routes/api/v1/projects/[id]/+server.js';

const codec = createApiTokenCodec('api-token-test-secret-32-chars-xx');
const DAY = 86_400_000;

let tp: TestProviders | null = null;

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

async function mint(t: TestProviders, userId: string, orgId: string, scopes: string[]) {
	const raw = codec.mintRawToken();
	const id = randomUUID();
	await t.config.data.apiTokens!.create(SYSTEM_CONTEXT, {
		id,
		userId,
		createdBy: userId,
		orgId,
		name: 'test',
		tokenHash: codec.hashToken(raw),
		scopes,
		createdAt: new Date().toISOString(),
		expiresAt: new Date(Date.now() + 30 * DAY).toISOString(),
		// Recent, so the resolver skips its background `lastUsedAt` write: that
		// write would race the temp-dir cleanup after each test.
		lastUsedAt: new Date().toISOString(),
		revokedAt: null
	});
	return { raw, id };
}

function resolve(t: TestProviders, raw: string, path = '/api/v1/projects', extra = {}) {
	return resolveApiToken(
		new Request(`http://selva.test${path}`, {
			headers: { authorization: `Bearer ${raw}`, ...extra }
		}),
		{ codec, auth: t.config.auth, data: t.config.data }
	);
}

/** What the hook puts on `locals` for a resolved key. */
async function localsFor(t: TestProviders, raw: string) {
	const result = await resolve(t, raw);
	if (result.kind !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(result)}`);
	return {
		user: result.user,
		ctx: result.ctx,
		profile: emptyProfile(result.user.id),
		providers: t.config,
		log: silentLog
	};
}

describe('API tokens on the local provider', () => {
	it('a read key lists projects but cannot create one', async () => {
		tp = await freshProviders();
		const { alice, acme } = await seedAcme(tp);
		const { raw } = await mint(tp, alice.id, acme.id, ['read:all']);
		const locals = await localsFor(tp, raw);

		expect((await call(GET, { locals })).status).toBe(200);

		const res = await call(POST, { locals, body: { name: 'Nope', visibility: 'private' } });
		expect(res.status).toBe(403);
		expect(res.json).toMatchObject({ details: { requiredScope: `write:org:${acme.id}` } });
	});

	it('a write key creates a project as its owner', async () => {
		tp = await freshProviders();
		const { alice, acme } = await seedAcme(tp);
		const { raw } = await mint(tp, alice.id, acme.id, ['write:all']);
		const locals = await localsFor(tp, raw);

		const res = await call(POST, { locals, body: { name: 'Keyed', visibility: 'private' } });
		expect(res.status).toBe(201);
	});

	it('a project key reads its project and is refused on the org-level list', async () => {
		tp = await freshProviders();
		const { alice, acme, acmeOrg, acmePublic } = await seedAcme(tp);
		const { raw } = await mint(tp, alice.id, acme.id, [`read:project:${acmeOrg.id}`]);
		const locals = await localsFor(tp, raw);

		expect((await call(getProject, { locals, params: { id: acmeOrg.id } })).status).toBe(200);
		expect((await call(getProject, { locals, params: { id: acmePublic.id } })).status).toBe(403);
		expect((await call(GET, { locals })).status).toBe(403);
	});

	it('a bad key gets 401 even with a valid session cookie alongside', async () => {
		tp = await freshProviders();
		await seedAcme(tp);
		const result = await resolve(tp, codec.mintRawToken(), '/api/v1/projects', {
			cookie: 'admin_session=a-perfectly-good-session'
		});
		expect(result).toMatchObject({ kind: 'rejected', status: 401 });
	});

	it('refuses every key on /api/admin/*, an instance admin’s included', async () => {
		tp = await freshProviders();
		const { alice, acme } = await seedAcme(tp);
		await grantPlatformPermissions(tp, alice.id, ['instance_admin']);
		const { raw } = await mint(tp, alice.id, acme.id, ['write:all']);

		expect(await resolve(tp, raw, '/api/admin/users')).toMatchObject({
			kind: 'rejected',
			status: 403
		});
		// And on /api/v1 the key carries none of the owner's instance authority.
		const ok = await resolve(tp, raw);
		expect(ok.kind === 'ok' && ok.ctx.platformPermissions).toEqual([]);
	});

	it('stops working once its owner leaves the org', async () => {
		tp = await freshProviders();
		const { bob, acme } = await seedAcme(tp);
		const { raw } = await mint(tp, bob.id, acme.id, ['read:all']);
		expect((await resolve(tp, raw)).kind).toBe('ok');

		await tp.config.data.orgs.removeOrgMember(SYSTEM_CONTEXT, acme.id, bob.id);
		expect(await resolve(tp, raw)).toMatchObject({ kind: 'rejected', status: 401 });
	});

	it('stops working once revoked', async () => {
		tp = await freshProviders();
		const { alice, acme } = await seedAcme(tp);
		const { raw, id } = await mint(tp, alice.id, acme.id, ['read:all']);
		await tp.config.data.apiTokens!.revoke(SYSTEM_CONTEXT, id, 'owner');
		expect(await resolve(tp, raw)).toMatchObject({ kind: 'rejected', status: 401 });
	});
});
