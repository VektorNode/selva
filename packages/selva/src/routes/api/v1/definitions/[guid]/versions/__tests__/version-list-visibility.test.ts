/**
 * A caller who cannot see a definition must get 404, never 403. Answering
 * "forbidden" confirms the guid exists and turns the route into a cross-tenant
 * existence oracle — the reason its two sibling routes resolve through
 * `getVisibleDefinition`.
 *
 * The secondary leak: version rows carry `uploadedBy` and `changeNote`, so the
 * pre-read must not happen before the visibility check either.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
	freshProviders,
	seedUser,
	seedOrg,
	seedOrgMember,
	seedProject,
	seedProjectMember,
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

describe('GET /api/v1/definitions/{guid}/versions — visibility', () => {
	it('404s for a definition in another org, not 403', async () => {
		tp = await freshProviders();

		const alice = await seedUser(tp, 'alice@acme.test');
		const acme = await seedOrg(tp, { name: 'Acme', slug: 'acme', ownerId: alice.id });
		await seedOrgMember(tp, { orgId: acme.id, userId: alice.id, role: 'owner' });
		const secret = await seedProject(tp, {
			orgId: acme.id,
			name: 'Secret',
			slug: 'secret',
			ownerId: alice.id,
			visibility: 'private'
		});
		const def = await seedDefinition(tp, { projectId: secret.id, ownerId: alice.id });

		// An outsider with their own org, no relationship to Acme.
		const mallory = await seedUser(tp, 'mallory@other.test');
		const other = await seedOrg(tp, { name: 'Other', slug: 'other', ownerId: mallory.id });
		await seedOrgMember(tp, { orgId: other.id, userId: mallory.id, role: 'owner' });
		const locals = await actAs(tp, mallory.id);

		const res = await call(GET, { locals, params: { guid: def.record.guid } });

		// 403 would confirm the guid resolves to a real definition.
		expect(res.status).toBe(404);
	});

	it('404s for a guid that does not exist at all', async () => {
		// Same status as the invisible case — that equality IS the property.
		tp = await freshProviders();
		const mallory = await seedUser(tp, 'mallory@other.test');
		const other = await seedOrg(tp, { name: 'Other', slug: 'other', ownerId: mallory.id });
		await seedOrgMember(tp, { orgId: other.id, userId: mallory.id, role: 'owner' });
		const locals = await actAs(tp, mallory.id);

		const res = await call(GET, {
			locals,
			params: { guid: '11111111-2222-3333-4444-555555555555' }
		});

		expect(res.status).toBe(404);
	});

	it('still lists versions for a member of the project', async () => {
		tp = await freshProviders();
		const alice = await seedUser(tp, 'alice@acme.test');
		const acme = await seedOrg(tp, { name: 'Acme', slug: 'acme', ownerId: alice.id });
		await seedOrgMember(tp, { orgId: acme.id, userId: alice.id, role: 'owner' });
		const project = await seedProject(tp, {
			orgId: acme.id,
			name: 'Mine',
			slug: 'mine',
			ownerId: alice.id,
			visibility: 'private'
		});
		await seedProjectMember(tp, { projectId: project.id, userId: alice.id, role: 'owner' });
		const def = await seedDefinition(tp, { projectId: project.id, ownerId: alice.id });
		const locals = await actAs(tp, alice.id);

		const res = await call(GET, { locals, params: { guid: def.record.guid } });

		expect(res.status).toBe(200);
		expect((res.json as { items: unknown[] }).items.length).toBeGreaterThan(0);
	});
});
