/**
 * Where an API token stops: its own org, and its owner's membership.
 *
 * A key is bound to the org it was minted in. Its owner may belong to other
 * orgs too, and a session reaches all of them; the key must not. And a key
 * must not outlive the membership it acts through.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { emptyProfile, SYSTEM_CONTEXT } from '@selvajs/platform';
import { resolveApiToken } from '@selvajs/server/http';
import {
	freshProviders,
	seedAcme,
	seedBigClient,
	seedDefinition,
	seedOrgMember,
	seedProject,
	grantPlatformPermissions,
	actAs,
	call,
	silentLog,
	type TestProviders
} from '../../__tests__/fixtures.js';
import { apiTokenCodec } from '../../apiTokens/token.server.js';
import { POST as mintToken } from '../../../../routes/api/v1/orgs/[orgId]/tokens/+server.js';
import { DELETE as removeMember } from '../../../../routes/api/v1/orgs/[orgId]/members/[userId]/+server.js';
import { GET as listProjects } from '../../../../routes/api/v1/projects/+server.js';
import { GET as getProject } from '../../../../routes/api/v1/projects/[id]/+server.js';
import { GET as listDefinitions } from '../../../../routes/api/v1/definitions/+server.js';
import {
	GET as getDefinition,
	PATCH as patchDefinition
} from '../../../../routes/api/v1/definitions/[guid]/+server.js';
import * as definitionRoute from '../../../../routes/api/v1/definitions/[guid]/+server.js';
import * as definitionSchemaRoute from '../../../../routes/api/v1/definitions/[guid]/schema/+server.js';
import * as definitionPublishRoute from '../../../../routes/api/v1/definitions/[guid]/publish/+server.js';
import * as definitionSolveRoute from '../../../../routes/api/v1/definitions/[guid]/solve/+server.js';
import * as shareLinksRoute from '../../../../routes/api/v1/definitions/[guid]/share-links/+server.js';
import * as versionsRoute from '../../../../routes/api/v1/definitions/[guid]/versions/+server.js';
import * as versionRoute from '../../../../routes/api/v1/definitions/[guid]/versions/[versionId]/+server.js';
import * as versionSchemaRoute from '../../../../routes/api/v1/definitions/[guid]/versions/[versionId]/schema/+server.js';
import * as projectRoute from '../../../../routes/api/v1/projects/[id]/+server.js';
import * as projectMembersRoute from '../../../../routes/api/v1/projects/[id]/members/+server.js';
import * as projectMemberRoute from '../../../../routes/api/v1/projects/[id]/members/[userId]/+server.js';
import * as reclaimRoute from '../../../../routes/api/v1/projects/[id]/reclaim/+server.js';
import * as orgRoute from '../../../../routes/api/v1/orgs/[orgId]/+server.js';
import * as orgMembersRoute from '../../../../routes/api/v1/orgs/[orgId]/members/+server.js';
import * as orgMemberRoute from '../../../../routes/api/v1/orgs/[orgId]/members/[userId]/+server.js';
import * as invitesRoute from '../../../../routes/api/v1/orgs/[orgId]/invites/+server.js';
import * as orgComputeRoute from '../../../../routes/api/v1/orgs/[orgId]/compute/+server.js';

let tp: TestProviders;

afterEach(async () => {
	await tp?.cleanup();
});

async function mint(userId: string, orgId: string, scopes = ['write:all']): Promise<string> {
	await grantPlatformPermissions(tp, userId, ['manage_api_tokens']);
	const res = await call(mintToken, {
		locals: await actAs(tp, userId),
		params: { orgId },
		body: { name: 'boundary', scopes, expiresInDays: 30 }
	});
	expect(res.status).toBe(201);
	return (res.json as { secret: string }).secret;
}

async function keyLocals(raw: string) {
	vi.spyOn(tp.config.data.apiTokens!, 'touchLastUsed').mockResolvedValue();
	const result = await resolveApiToken(
		new Request('http://selva.test/api/v1/projects', {
			headers: { authorization: `Bearer ${raw}` }
		}),
		{ codec: apiTokenCodec(), auth: tp.config.auth, data: tp.config.data }
	);
	if (result.kind !== 'ok') throw new Error(`key rejected: ${result.kind}`);
	return {
		user: result.user,
		ctx: result.ctx,
		profile: emptyProfile(result.user.id),
		providers: tp.config,
		log: silentLog
	};
}

/** Alice belongs to Acme and Big Client, with a project and a definition in each. */
async function twoOrgs() {
	tp = await freshProviders();
	const { alice, acme, alicesPrivate } = await seedAcme(tp);
	const { bigClient } = await seedBigClient(tp);
	await seedOrgMember(tp, { orgId: bigClient.id, userId: alice.id, role: 'member' });
	const elsewhere = await seedProject(tp, {
		orgId: bigClient.id,
		name: 'Alice at Big Client',
		slug: 'alice-bc',
		ownerId: alice.id,
		visibility: 'private'
	});
	const home = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
	const away = await seedDefinition(tp, { projectId: elsewhere.id, ownerId: alice.id });
	return { alice, acme, bigClient, alicesPrivate, elsewhere, home, away };
}

describe('API token org boundary', () => {
	it("lists only the token's org, though the owner's session sees both", async () => {
		const { alice, acme, alicesPrivate, elsewhere, home, away } = await twoOrgs();
		const session = await actAs(tp, alice.id);
		const sessionIds = (
			(await call(listProjects, { locals: session })).json as { items: { id: string }[] }
		).items.map((p) => p.id);
		expect(sessionIds).toEqual(expect.arrayContaining([alicesPrivate.id, elsewhere.id]));

		const keyed = await keyLocals(await mint(alice.id, acme.id));
		const projectIds = (
			(await call(listProjects, { locals: keyed })).json as { items: { id: string }[] }
		).items.map((p) => p.id);
		expect(projectIds).toContain(alicesPrivate.id);
		expect(projectIds).not.toContain(elsewhere.id);

		const guids = (
			(await call(listDefinitions, { locals: keyed })).json as { items: { guid: string }[] }
		).items.map((d) => d.guid);
		expect(guids).toContain(home.record.guid);
		expect(guids).not.toContain(away.record.guid);
	});

	it("treats the other org's project and definition as missing", async () => {
		const { alice, acme, elsewhere, away } = await twoOrgs();
		const keyed = await keyLocals(await mint(alice.id, acme.id));

		expect((await call(getProject, { locals: keyed, params: { id: elsewhere.id } })).status).toBe(
			404
		);
		expect(
			(await call(getDefinition, { locals: keyed, params: { guid: away.record.guid } })).status
		).toBe(404);
		const edit = await call(patchDefinition, {
			locals: keyed,
			params: { guid: away.record.guid },
			body: { description: 'from the wrong org' }
		});
		expect(edit.status).toBe(404);
	});

	it("won't move a definition into the other org", async () => {
		const { alice, acme, elsewhere, home } = await twoOrgs();
		const keyed = await keyLocals(await mint(alice.id, acme.id));
		const moved = await call(patchDefinition, {
			locals: keyed,
			params: { guid: home.record.guid },
			body: { projectId: elsewhere.id }
		});
		expect(moved.status).toBe(404);
		const record = await tp.config.data.definitions.get(SYSTEM_CONTEXT, home.record.guid);
		expect(record?.projectId).not.toBe(elsewhere.id);
	});
});

describe('API token org boundary, every route addressed by id', () => {
	type Handler = (event: never) => unknown;
	type Ids = Awaited<ReturnType<typeof twoOrgs>>;
	// The key's owner can reach every one of these from a session; the key, minted
	// in Acme, must find nothing at Big Client. Write bodies are minimal: the
	// boundary has to hold before validation would ever matter.
	const routes: [string, string, Handler, (ids: Ids) => Record<string, string>, unknown?][] = [
		['GET', 'definitions/[guid]', definitionRoute.GET, (i) => ({ guid: i.away.record.guid })],
		[
			'PATCH',
			'definitions/[guid]',
			definitionRoute.PATCH,
			(i) => ({ guid: i.away.record.guid }),
			{ description: 'x' }
		],
		['DELETE', 'definitions/[guid]', definitionRoute.DELETE, (i) => ({ guid: i.away.record.guid })],
		[
			'GET',
			'definitions/[guid]/schema',
			definitionSchemaRoute.GET,
			(i) => ({ guid: i.away.record.guid })
		],
		[
			'POST',
			'definitions/[guid]/publish',
			definitionPublishRoute.POST,
			(i) => ({ guid: i.away.record.guid }),
			{ versionId: '00000000-0000-4000-8000-000000000000' }
		],
		[
			'POST',
			'definitions/[guid]/solve',
			definitionSolveRoute.POST,
			(i) => ({ guid: i.away.record.guid }),
			{ values: {} }
		],
		[
			'GET',
			'definitions/[guid]/share-links',
			shareLinksRoute.GET,
			(i) => ({ guid: i.away.record.guid })
		],
		[
			'POST',
			'definitions/[guid]/share-links',
			shareLinksRoute.POST,
			(i) => ({ guid: i.away.record.guid }),
			{}
		],
		[
			'GET',
			'definitions/[guid]/versions',
			versionsRoute.GET,
			(i) => ({ guid: i.away.record.guid })
		],
		[
			'GET',
			'definitions/[guid]/versions/[versionId]',
			versionRoute.GET,
			(i) => ({ guid: i.away.record.guid, versionId: i.away.version.id })
		],
		[
			'DELETE',
			'definitions/[guid]/versions/[versionId]',
			versionRoute.DELETE,
			(i) => ({ guid: i.away.record.guid, versionId: i.away.version.id })
		],
		[
			'GET',
			'definitions/[guid]/versions/[versionId]/schema',
			versionSchemaRoute.GET,
			(i) => ({ guid: i.away.record.guid, versionId: i.away.version.id })
		],
		['GET', 'projects/[id]', projectRoute.GET, (i) => ({ id: i.elsewhere.id })],
		['PATCH', 'projects/[id]', projectRoute.PATCH, (i) => ({ id: i.elsewhere.id }), { name: 'x' }],
		['DELETE', 'projects/[id]', projectRoute.DELETE, (i) => ({ id: i.elsewhere.id })],
		['GET', 'projects/[id]/members', projectMembersRoute.GET, (i) => ({ id: i.elsewhere.id })],
		[
			'POST',
			'projects/[id]/members',
			projectMembersRoute.POST,
			(i) => ({ id: i.elsewhere.id }),
			{ userId: '00000000-0000-4000-8000-000000000000', role: 'viewer' }
		],
		[
			'DELETE',
			'projects/[id]/members/[userId]',
			projectMemberRoute.DELETE,
			(i) => ({ id: i.elsewhere.id, userId: i.alice.id })
		],
		['POST', 'projects/[id]/reclaim', reclaimRoute.POST, (i) => ({ id: i.elsewhere.id }), {}],
		['GET', 'orgs/[orgId]', orgRoute.GET, (i) => ({ orgId: i.bigClient.id })],
		['GET', 'orgs/[orgId]/members', orgMembersRoute.GET, (i) => ({ orgId: i.bigClient.id })],
		[
			'DELETE',
			'orgs/[orgId]/members/[userId]',
			orgMemberRoute.DELETE,
			(i) => ({ orgId: i.bigClient.id, userId: i.alice.id })
		],
		['GET', 'orgs/[orgId]/invites', invitesRoute.GET, (i) => ({ orgId: i.bigClient.id })],
		['GET', 'orgs/[orgId]/compute', orgComputeRoute.GET, (i) => ({ orgId: i.bigClient.id })]
	];

	it.each(routes)(
		'%s %s finds nothing in the other org',
		async (method, _path, handler, params, body) => {
			const ids = await twoOrgs();
			const keyed = await keyLocals(await mint(ids.alice.id, ids.acme.id));
			const res = await call(handler as never, {
				locals: keyed,
				method,
				params: params(ids),
				body
			});
			expect([403, 404]).toContain(res.status);
			const text = JSON.stringify(res.json ?? '');
			expect(text).not.toContain(ids.elsewhere.id);
			expect(text).not.toContain(ids.bigClient.id);
		}
	);
});

describe('moving a definition', () => {
	it("won't carry a definition out of a project-scoped key's project", async () => {
		tp = await freshProviders();
		const { alice, acme, alicesPrivate } = await seedAcme(tp);
		const alsoAlices = await seedProject(tp, {
			orgId: acme.id,
			name: 'Alice too',
			slug: 'alice-too',
			ownerId: alice.id,
			visibility: 'private'
		});
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		const keyed = await keyLocals(
			await mint(alice.id, acme.id, [`write:project:${alicesPrivate.id}`])
		);

		const res = await call(patchDefinition, {
			locals: keyed,
			method: 'PATCH',
			params: { guid: def.record.guid },
			body: { projectId: alsoAlices.id }
		});
		expect(res.status).toBe(403);
		expect((await tp.config.data.definitions.get(SYSTEM_CONTEXT, def.record.guid))?.projectId).toBe(
			alicesPrivate.id
		);
	});

	it('needs edit rights on the destination, from a session too', async () => {
		tp = await freshProviders();
		const { alice, bob, acme, alicesPrivate } = await seedAcme(tp);
		const bobsOwn = await seedProject(tp, {
			orgId: acme.id,
			name: 'Bob only',
			slug: 'bob-only',
			ownerId: bob.id,
			visibility: 'private'
		});
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });

		const res = await call(patchDefinition, {
			locals: await actAs(tp, alice.id),
			params: { guid: def.record.guid },
			body: { projectId: bobsOwn.id }
		});
		expect(res.status).toBe(403);
		expect((await tp.config.data.definitions.get(SYSTEM_CONTEXT, def.record.guid))?.projectId).toBe(
			alicesPrivate.id
		);
	});
});

describe('API tokens follow membership', () => {
	it("revokes a member's keys when they're removed from the org", async () => {
		tp = await freshProviders();
		const { alice, bob, acme } = await seedAcme(tp);
		const raw = await mint(bob.id, acme.id, ['read:all']);

		const res = await call(removeMember, {
			locals: await actAs(tp, alice.id),
			params: { orgId: acme.id, userId: bob.id }
		});
		expect(res.status).toBe(204);

		const { items } = await tp.config.data.apiTokens!.listByOrg(SYSTEM_CONTEXT, acme.id, {
			userId: bob.id
		});
		expect(items).toHaveLength(1);
		expect(items[0]!.revokedAt).toBeTruthy();

		// Re-adding Bob doesn't bring the key back.
		await seedOrgMember(tp, { orgId: acme.id, userId: bob.id, role: 'member' });
		const again = await resolveApiToken(
			new Request('http://selva.test/api/v1/projects', {
				headers: { authorization: `Bearer ${raw}` }
			}),
			{ codec: apiTokenCodec(), auth: tp.config.auth, data: tp.config.data }
		);
		expect(again).toMatchObject({ kind: 'rejected', status: 401 });
	});
});
