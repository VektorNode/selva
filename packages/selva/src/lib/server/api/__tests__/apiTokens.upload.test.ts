/**
 * The `upload` scope, route by route: exactly creating definitions, uploading
 * versions, making a version live and previewing a file's schema. Anything
 * else gets 403 naming the missing scope, and `write` keys keep uploading.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { emptyProfile, SYSTEM_CONTEXT, type ComputeServerConfig } from '@selvajs/platform';
import { resolveApiToken } from '@selvajs/server/http';
import {
	freshProviders,
	seedAcme,
	seedAcmeDesigner,
	seedDefinition,
	grantPlatformPermissions,
	actAs,
	call,
	silentLog,
	type TestProviders
} from '../../__tests__/fixtures.js';
import { apiTokenCodec } from '../../apiTokens/token.server.js';
import { POST as mintToken } from '../../../../routes/api/v1/orgs/[orgId]/tokens/+server.js';
import * as definitionsRoute from '../../../../routes/api/v1/definitions/+server.js';
import * as definitionRoute from '../../../../routes/api/v1/definitions/[guid]/+server.js';
import * as versionsRoute from '../../../../routes/api/v1/definitions/[guid]/versions/+server.js';
import * as versionRoute from '../../../../routes/api/v1/definitions/[guid]/versions/[versionId]/+server.js';
import * as publishRoute from '../../../../routes/api/v1/definitions/[guid]/publish/+server.js';
import * as imageRoute from '../../../../routes/api/v1/definitions/[guid]/image/+server.js';
import * as shareLinksRoute from '../../../../routes/api/v1/definitions/[guid]/share-links/+server.js';
import * as projectsRoute from '../../../../routes/api/v1/projects/+server.js';
import * as schemaRoute from '../../../../routes/api/v1/compute/schema/+server.js';
import * as meRoute from '../../../../routes/api/v1/me/+server.js';
import * as meTokenRoute from '../../../../routes/api/v1/me/token/+server.js';
import * as orgRoute from '../../../../routes/api/v1/orgs/[orgId]/+server.js';

let tp: TestProviders;

afterEach(async () => {
	vi.restoreAllMocks();
	await tp?.cleanup();
});

async function mint(userId: string, orgId: string, scopes: string[]): Promise<string> {
	const res = await call(mintToken, {
		locals: await actAs(tp, userId),
		params: { orgId },
		body: { name: 'plugin', scopes, expiresInDays: 30 }
	});
	expect(res.status).toBe(201);
	return (res.json as { secret: string }).secret;
}

async function resolve(raw: string) {
	vi.spyOn(tp.config.data.apiTokens!, 'touchLastUsed').mockResolvedValue();
	return resolveApiToken(
		new Request('http://selva.test/api/v1/me', { headers: { authorization: `Bearer ${raw}` } }),
		{ codec: apiTokenCodec(), auth: tp.config.auth, data: tp.config.data }
	);
}

async function keyLocals(raw: string) {
	const result = await resolve(raw);
	if (result.kind !== 'ok') throw new Error(`key rejected: ${JSON.stringify(result)}`);
	return {
		user: result.user,
		ctx: result.ctx,
		profile: emptyProfile(result.user.id),
		providers: tp.config,
		log: silentLog
	};
}

async function withCompute(): Promise<void> {
	const server: ComputeServerConfig = {
		id: 'srv-1',
		label: 'Test',
		serverUrl: 'http://compute.test',
		scope: 'platform',
		sharedWith: 'all'
	};
	await tp.config.data.computeServer.savePlatformServers(SYSTEM_CONTEXT, [server], server.id);
	vi.spyOn(globalThis, 'fetch').mockImplementation(
		async () =>
			new Response(
				JSON.stringify([
					{ fileName: 'def.gh', schemas: [{ name: 'Test', inputs: [], outputs: [] }] }
				]),
				{ status: 200, headers: { 'Content-Type': 'application/json' } }
			)
	);
}

function ghForm(fields: Record<string, string> = {}): FormData {
	const form = new FormData();
	form.append('file', new Blob([new Uint8Array([1, 2, 3])]), 'def.gh');
	for (const [k, v] of Object.entries(fields)) form.append(k, v);
	return form;
}

/** Acme, plus Dana: a member who edits one project and holds no platform permission. */
async function world() {
	tp = await freshProviders();
	const acme = await seedAcme(tp);
	const dana = await seedAcmeDesigner(tp, acme);
	await withCompute();
	return { ...acme, dana };
}

describe('an upload key', () => {
	it('creates a definition, uploads a version and makes it live', async () => {
		const w = await world();
		const locals = await keyLocals(await mint(w.dana.id, w.acme.id, ['upload:all']));

		const schema = await call(schemaRoute.POST, {
			locals,
			url: `http://test.local/api/v1/compute/schema?projectId=${w.acmeOrg.id}`,
			body: ghForm()
		});
		expect(schema.status).toBe(200);

		const created = await call(definitionsRoute.POST, {
			locals,
			body: ghForm({ projectId: w.acmeOrg.id, displayName: 'Facade panel' })
		});
		expect(created.status).toBe(201);
		const { guid } = created.json as { guid: string };

		const version = await call(versionsRoute.POST, {
			locals,
			params: { guid },
			body: ghForm({ changeNote: 'From Grasshopper' })
		});
		expect(version.status).toBe(201);
		const versionId = (version.json as { version: { id: string } }).version.id;

		const live = await call(publishRoute.POST, { locals, params: { guid }, body: { versionId } });
		expect(live.status).toBe(200);
		const record = await tp.config.data.definitions.get(SYSTEM_CONTEXT, guid);
		expect(record?.liveVersionId).toBe(versionId);
	});

	it('reads, since upload includes read', async () => {
		const w = await world();
		const raw = await mint(w.dana.id, w.acme.id, ['upload:all']);
		const locals = await keyLocals(raw);
		const me = await call(meRoute.GET, { locals });
		expect(me.status).toBe(200);
		const { apiToken } = me.json as { apiToken: { scopes: string[]; expiresAt: string } };
		expect(apiToken.scopes).toEqual(['upload:all']);
		expect(Date.parse(apiToken.expiresAt)).toBeGreaterThan(Date.now() + 29 * 86_400_000);
		expect((await call(orgRoute.GET, { locals, params: { orgId: w.acme.id } })).json).toMatchObject(
			{ name: 'Acme' }
		);
	});

	it('is refused, naming the scope, on everything else', async () => {
		const w = await world();
		const locals = await keyLocals(await mint(w.dana.id, w.acme.id, ['upload:all']));
		const { record, version } = await seedDefinition(tp, {
			projectId: w.acmeOrg.id,
			ownerId: w.dana.id
		});
		const guid = record.guid;

		const refused = [
			await call(definitionRoute.PATCH, {
				locals,
				params: { guid },
				method: 'PATCH',
				body: { displayName: 'Renamed' }
			}),
			await call(definitionRoute.DELETE, { locals, params: { guid }, method: 'DELETE' }),
			await call(versionRoute.DELETE, {
				locals,
				params: { guid, versionId: version.id },
				method: 'DELETE'
			}),
			await call(shareLinksRoute.POST, { locals, params: { guid }, body: {} }),
			await call(imageRoute.POST, { locals, params: { guid }, body: new FormData() }),
			await call(projectsRoute.POST, { locals, body: { name: 'New', visibility: 'org' } })
		];
		for (const res of refused) {
			expect(res.status).toBe(403);
			expect(res.json).toMatchObject({
				details: { requiredScope: expect.stringMatching(/^write:/) }
			});
		}
		expect(await tp.config.data.definitions.get(SYSTEM_CONTEXT, guid)).toMatchObject({
			displayName: record.displayName
		});
	});

	it('revokes itself, and nothing else', async () => {
		const w = await world();
		const raw = await mint(w.dana.id, w.acme.id, ['upload:all']);
		const kept = await mint(w.dana.id, w.acme.id, ['upload:all']);
		const res = await call(meTokenRoute.DELETE, {
			locals: await keyLocals(raw),
			method: 'DELETE'
		});
		expect(res.status).toBe(204);
		expect(await resolve(raw)).toMatchObject({ kind: 'rejected', status: 401 });
		expect((await resolve(kept)).kind).toBe('ok');
	});
});

describe('the token page', () => {
	async function presets(locals: object) {
		const { load } = await import('../../../../routes/team/tokens/+page.server.js');
		try {
			const data = (await load({
				locals,
				params: {},
				url: new URL('http://test.local/')
			} as never)) as {
				presets: string[];
			};
			return data.presets;
		} catch (err) {
			const r = err as { status?: number; location?: string };
			if (r.status === 303) return r.location;
			throw err;
		}
	}

	it('offers only the upload preset to someone who can only hold upload keys', async () => {
		const w = await world();
		expect(await presets(await actAs(tp, w.dana.id))).toEqual(['upload']);
	});

	it('offers every preset to a holder of manage_api_tokens', async () => {
		const w = await world();
		await grantPlatformPermissions(tp, w.dana.id, ['manage_api_tokens']);
		expect(await presets(await actAs(tp, w.dana.id))).toEqual([
			'read',
			'upload',
			'solve',
			'write',
			'full'
		]);
	});

	it('sends someone who may hold no key back to /team', async () => {
		const w = await world();
		expect(await presets(await actAs(tp, w.bob.id))).toBe('/team');
	});
});

describe('the other actions', () => {
	it('a write key still uploads', async () => {
		const w = await world();
		await grantPlatformPermissions(tp, w.alice.id, ['manage_api_tokens']);
		const locals = await keyLocals(await mint(w.alice.id, w.acme.id, ['write:all']));
		const created = await call(definitionsRoute.POST, {
			locals,
			body: ghForm({ projectId: w.acmeOrg.id, displayName: 'By write key' })
		});
		expect(created.status).toBe(201);
	});

	it('a read key can’t upload', async () => {
		const w = await world();
		const locals = await keyLocals(await mint(w.dana.id, w.acme.id, ['read:all']));
		const res = await call(definitionsRoute.POST, {
			locals,
			body: ghForm({ projectId: w.acmeOrg.id, displayName: 'Nope' })
		});
		expect(res.status).toBe(403);
		expect(res.json).toMatchObject({ details: { requiredScope: `upload:org:${w.acme.id}` } });
	});

	it('a browser session can’t revoke "its" token', async () => {
		const w = await world();
		const res = await call(meTokenRoute.DELETE, {
			locals: await actAs(tp, w.dana.id),
			method: 'DELETE'
		});
		expect(res.status).toBe(400);
	});
});
