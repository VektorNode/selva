/**
 * Demoting an owner reduces the owner count exactly as removing one does, so
 * PATCH runs the same `checkOwnerRemoval` guard DELETE has always run.
 *
 * A sole owner who PATCHes themselves to `viewer` loses `canManage`,
 * `canEditProjectSettings` and `canEdit` in one step, and the project is
 * recoverable only through reclaim or `instance_admin`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import {
	freshProviders,
	seedAcme,
	seedProject,
	seedProjectMember,
	seedUser,
	seedOrgMember,
	actAs,
	call,
	type TestProviders
} from '$lib/server/__tests__/fixtures.js';
import { PATCH } from '../+server.js';

let tp: TestProviders | null = null;

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

describe('PATCH /api/v1/projects/{id}/members/{userId} — owner count', () => {
	it('refuses to demote the sole owner', async () => {
		tp = await freshProviders();
		const { alice, acme } = await seedAcme(tp);
		const project = await seedProject(tp, {
			orgId: acme.id,
			name: 'Solo',
			slug: 'solo',
			ownerId: alice.id
		});
		await seedProjectMember(tp, { projectId: project.id, userId: alice.id, role: 'owner' });
		const locals = await actAs(tp, alice.id);

		const res = await call(PATCH, {
			locals,
			params: { id: project.id, userId: alice.id },
			body: { role: 'viewer' }
		});

		expect(res.status).toBe(409);

		const still = await tp.config.data.projects.getProjectMember(
			SYSTEM_CONTEXT,
			project.id,
			alice.id
		);
		expect(still?.role).toBe('owner');
	});

	it('requires confirmation to demote a co-owner', async () => {
		tp = await freshProviders();
		const { alice, acme } = await seedAcme(tp);
		const carol = await seedUser(tp, 'carol@acme.test');
		await seedOrgMember(tp, { orgId: acme.id, userId: carol.id, role: 'member' });
		const project = await seedProject(tp, {
			orgId: acme.id,
			name: 'Shared',
			slug: 'shared',
			ownerId: alice.id
		});
		await seedProjectMember(tp, { projectId: project.id, userId: alice.id, role: 'owner' });
		await seedProjectMember(tp, { projectId: project.id, userId: carol.id, role: 'owner' });
		const locals = await actAs(tp, alice.id);

		const res = await call(PATCH, {
			locals,
			params: { id: project.id, userId: carol.id },
			body: { role: 'viewer' }
		});
		expect(res.status).toBe(409);

		const confirmed = await call(PATCH, {
			locals,
			params: { id: project.id, userId: carol.id },
			url: 'http://test.local/?confirm=true',
			body: { role: 'viewer' }
		});
		expect(confirmed.status).toBe(204);
	});

	it('allows demoting a non-owner without confirmation', async () => {
		// The guard must stay out of the way of ordinary role changes.
		tp = await freshProviders();
		const { alice, acme } = await seedAcme(tp);
		const carol = await seedUser(tp, 'carol@acme.test');
		await seedOrgMember(tp, { orgId: acme.id, userId: carol.id, role: 'member' });
		const project = await seedProject(tp, {
			orgId: acme.id,
			name: 'Shared',
			slug: 'shared',
			ownerId: alice.id
		});
		await seedProjectMember(tp, { projectId: project.id, userId: alice.id, role: 'owner' });
		await seedProjectMember(tp, { projectId: project.id, userId: carol.id, role: 'editor' });
		const locals = await actAs(tp, alice.id);

		const res = await call(PATCH, {
			locals,
			params: { id: project.id, userId: carol.id },
			body: { role: 'viewer' }
		});

		expect(res.status).toBe(204);
	});

	it('allows promoting a member to owner', async () => {
		tp = await freshProviders();
		const { alice, acme } = await seedAcme(tp);
		const carol = await seedUser(tp, 'carol@acme.test');
		await seedOrgMember(tp, { orgId: acme.id, userId: carol.id, role: 'member' });
		const project = await seedProject(tp, {
			orgId: acme.id,
			name: 'Shared',
			slug: 'shared',
			ownerId: alice.id
		});
		await seedProjectMember(tp, { projectId: project.id, userId: alice.id, role: 'owner' });
		await seedProjectMember(tp, { projectId: project.id, userId: carol.id, role: 'editor' });
		const locals = await actAs(tp, alice.id);

		const res = await call(PATCH, {
			locals,
			params: { id: project.id, userId: carol.id },
			body: { role: 'owner' }
		});

		expect(res.status).toBe(204);
	});
});
