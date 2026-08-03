/**
 * `listVisibleDefinitions` is the tenancy boundary for `GET /api/v1/definitions`.
 *
 * It scans projects as `SYSTEM_CONTEXT` and relies entirely on `canView` over
 * the fetched membership rows to keep one org's definitions out of another's
 * results. A bug here is a cross-tenant leak on a PAT-reachable public endpoint,
 * so the tests below assert *absence* — that a caller never receives a row —
 * rather than only that the expected rows are present.
 *
 * The pagination tests are the other half: visibility has to be applied in the
 * query, not over the fetched page, or `limit` and `nextCursor` describe
 * positions in a set the caller can't see.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { listVisibleDefinitions, getVisibleDefinition } from '../visibility.server.js';
import {
	freshProviders,
	seedAcme,
	seedBigClient,
	seedDefinition,
	seedProject,
	seedProjectMember,
	actAs,
	type TestProviders
} from '../../__tests__/fixtures.js';

let tp: TestProviders;

afterEach(async () => {
	await tp?.cleanup();
});

describe('listVisibleDefinitions', () => {
	it('never returns another org’s definitions', async () => {
		tp = await freshProviders();
		const { acme, alice, alicesPrivate, acmeOrg } = await seedAcme(tp);
		const { bigClient, carol } = await seedBigClient(tp);

		const bigClientProject = await seedProject(tp, {
			orgId: bigClient.id,
			name: 'BigClient Secret',
			slug: 'bigclient-secret',
			ownerId: carol.id,
			visibility: 'org'
		});
		const carolsDef = await seedDefinition(tp, {
			projectId: bigClientProject.id,
			ownerId: carol.id,
			displayName: 'Carol Secret'
		});
		await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		await seedDefinition(tp, { projectId: acmeOrg.id, ownerId: alice.id });

		const { ctx } = await actAs(tp, alice.id);
		const page = await listVisibleDefinitions({ ...ctx, actingOrgId: acme.id });

		expect(page.items.map((r) => r.guid)).not.toContain(carolsDef.record.guid);
		expect(page.projects.map((p) => p.id)).not.toContain(bigClientProject.id);
	});

	it('excludes a private project the caller is not a member of', async () => {
		tp = await freshProviders();
		const { acme, alice, bob, alicesPrivate } = await seedAcme(tp);
		const hidden = await seedDefinition(tp, {
			projectId: alicesPrivate.id,
			ownerId: alice.id,
			displayName: 'Alice Private Def'
		});

		// Bob is an Acme member but not a member of Alice's private project.
		const { ctx } = await actAs(tp, bob.id);
		const page = await listVisibleDefinitions({ ...ctx, actingOrgId: acme.id });

		expect(page.items.map((r) => r.guid)).not.toContain(hidden.record.guid);
	});

	it('includes a private project once the caller is a member', async () => {
		tp = await freshProviders();
		const { acme, alice, bob, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		await seedProjectMember(tp, {
			projectId: alicesPrivate.id,
			userId: bob.id,
			role: 'viewer'
		});

		const { ctx } = await actAs(tp, bob.id);
		const page = await listVisibleDefinitions({ ...ctx, actingOrgId: acme.id });

		expect(page.items.map((r) => r.guid)).toContain(def.record.guid);
	});

	it('returns an empty page — not an unfiltered one — when nothing is visible', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		const { bigClient, carol } = await seedBigClient(tp);
		await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });

		// Carol acts in BigClient, which has no projects at all.
		const { ctx } = await actAs(tp, carol.id);
		const page = await listVisibleDefinitions({ ...ctx, actingOrgId: bigClient.id });

		expect(page.items).toEqual([]);
	});

	it('pages over only visible definitions — every page is full until the last', async () => {
		tp = await freshProviders();
		const { acme, alice, bob, acmeOrg, alicesPrivate } = await seedAcme(tp);

		// 6 visible (org project) interleaved with 6 invisible (Alice's private
		// project). A post-hoc filter over a page of 4 would return short pages.
		for (let i = 0; i < 6; i++) {
			await seedDefinition(tp, {
				projectId: acmeOrg.id,
				ownerId: alice.id,
				displayName: `Visible ${i}`
			});
			await seedDefinition(tp, {
				projectId: alicesPrivate.id,
				ownerId: alice.id,
				displayName: `Hidden ${i}`
			});
		}

		const { ctx } = await actAs(tp, bob.id);
		const bobCtx = { ...ctx, actingOrgId: acme.id };

		const seen: string[] = [];
		let cursor: string | undefined;
		for (let guard = 0; guard < 10; guard++) {
			const page = await listVisibleDefinitions(bobCtx, { limit: 4, cursor });
			// Short pages before the end mean visibility ran after the fetch.
			if (page.nextCursor) expect(page.items).toHaveLength(4);
			seen.push(...page.items.map((r) => r.guid));
			cursor = page.nextCursor;
			if (!cursor) break;
		}

		expect(seen).toHaveLength(6);
		expect(new Set(seen).size).toBe(6);
	});

	it('narrows to one project, and yields nothing for a project the caller cannot see', async () => {
		tp = await freshProviders();
		const { acme, alice, bob, acmeOrg, alicesPrivate } = await seedAcme(tp);
		const visible = await seedDefinition(tp, { projectId: acmeOrg.id, ownerId: alice.id });
		await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });

		const { ctx } = await actAs(tp, bob.id);
		const bobCtx = { ...ctx, actingOrgId: acme.id };

		const scoped = await listVisibleDefinitions(bobCtx, { projectId: acmeOrg.id });
		expect(scoped.items.map((r) => r.guid)).toEqual([visible.record.guid]);

		// An invisible project yields an empty page, not a 403 — the endpoint must
		// not confirm that the project exists.
		const denied = await listVisibleDefinitions(bobCtx, { projectId: alicesPrivate.id });
		expect(denied.items).toEqual([]);
	});
});

describe('getVisibleDefinition', () => {
	it('returns null for a definition in another org', async () => {
		tp = await freshProviders();
		const { acme, alice } = await seedAcme(tp);
		const { bigClient, carol } = await seedBigClient(tp);
		const carolsProject = await seedProject(tp, {
			orgId: bigClient.id,
			name: 'BigClient Only',
			slug: 'bigclient-only',
			ownerId: carol.id,
			visibility: 'org'
		});
		const carolsDef = await seedDefinition(tp, {
			projectId: carolsProject.id,
			ownerId: carol.id
		});

		const { ctx } = await actAs(tp, alice.id);
		const got = await getVisibleDefinition({ ...ctx, actingOrgId: acme.id }, carolsDef.record.guid);

		// null, not a throw: the caller renders 404 so the guid isn't confirmed.
		expect(got).toBeNull();
	});

	it('returns the record when the caller can view its project', async () => {
		tp = await freshProviders();
		const { acme, alice, bob, acmeOrg } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: acmeOrg.id, ownerId: alice.id });

		const { ctx } = await actAs(tp, bob.id);
		const got = await getVisibleDefinition({ ...ctx, actingOrgId: acme.id }, def.record.guid);

		expect(got?.guid).toBe(def.record.guid);
	});

	it('returns null for a guid that does not exist', async () => {
		tp = await freshProviders();
		const { acme, alice } = await seedAcme(tp);
		const { ctx } = await actAs(tp, alice.id);

		const got = await getVisibleDefinition(
			{ ...ctx, actingOrgId: acme.id },
			'00000000-0000-4000-8000-000000000000'
		);
		expect(got).toBeNull();
	});
});
