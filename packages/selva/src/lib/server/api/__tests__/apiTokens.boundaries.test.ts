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
	return { alice, acme, alicesPrivate, elsewhere, home, away };
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

describe('moving a definition', () => {
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
