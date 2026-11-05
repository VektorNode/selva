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
import { freshHarness, type HandlerHarness } from '../../__tests__/local-harness.js';
import {
	seedAcme,
	seedProject,
	seedProjectMember,
	seedUser,
	seedOrgMember,
	actAs,
	callHandler
} from '../../testing/index.js';
import { removeProjectMember, updateProjectMemberRole } from '../projectMembers.js';

let tp: HandlerHarness | null = null;

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

describe('PATCH /api/v1/projects/{id}/members/{userId} — owner count', () => {
	it('refuses to demote the sole owner', async () => {
		tp = await freshHarness();
		const { alice, acme } = await seedAcme(tp);
		const project = await seedProject(tp, {
			orgId: acme.id,
			name: 'Solo',
			slug: 'solo',
			ownerId: alice.id
		});
		await seedProjectMember(tp, { projectId: project.id, userId: alice.id, role: 'owner' });
		const locals = await actAs(tp, alice.id);

		const res = await callHandler(updateProjectMemberRole, {
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
		tp = await freshHarness();
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

		const res = await callHandler(updateProjectMemberRole, {
			locals,
			params: { id: project.id, userId: carol.id },
			body: { role: 'viewer' }
		});
		expect(res.status).toBe(409);

		const confirmed = await callHandler(updateProjectMemberRole, {
			locals,
			params: { id: project.id, userId: carol.id },
			url: 'http://test.local/?confirm=true',
			body: { role: 'viewer' }
		});
		expect(confirmed.status).toBe(204);
	});

	it('allows demoting a non-owner without confirmation', async () => {
		// The guard must stay out of the way of ordinary role changes.
		tp = await freshHarness();
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

		const res = await callHandler(updateProjectMemberRole, {
			locals,
			params: { id: project.id, userId: carol.id },
			body: { role: 'viewer' }
		});

		expect(res.status).toBe(204);
	});

	it('allows promoting a member to owner', async () => {
		tp = await freshHarness();
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

		const res = await callHandler(updateProjectMemberRole, {
			locals,
			params: { id: project.id, userId: carol.id },
			body: { role: 'owner' }
		});

		expect(res.status).toBe(204);
	});
});

describe('two project owners acting on each other at once', () => {
	async function coOwners() {
		tp = await freshHarness();
		const { acme, alice, bob } = await seedAcme(tp);
		const project = await seedProject(tp, {
			orgId: acme.id,
			name: 'Shared',
			slug: 'shared',
			ownerId: alice.id,
			visibility: 'private'
		});
		await seedProjectMember(tp, { projectId: project.id, userId: alice.id, role: 'owner' });
		await seedProjectMember(tp, { projectId: project.id, userId: bob.id, role: 'owner' });
		const [la, lb] = await Promise.all([actAs(tp, alice.id), actAs(tp, bob.id)]);
		return { alice, bob, project, la, lb, query: 'http://t/?confirm=true' };
	}

	it('leaves one owner when they demote each other', async () => {
		const { alice, bob, project, la, lb, query } = await coOwners();

		const results = await Promise.all([
			callHandler(updateProjectMemberRole, {
				locals: la,
				method: 'PATCH',
				url: query,
				params: { id: project.id, userId: bob.id },
				body: { role: 'viewer' }
			}),
			callHandler(updateProjectMemberRole, {
				locals: lb,
				method: 'PATCH',
				url: query,
				params: { id: project.id, userId: alice.id },
				body: { role: 'viewer' }
			})
		]);

		const members = await tp!.config.data.projects.listProjectMembers(SYSTEM_CONTEXT, project.id);
		expect(members.items.filter((m) => m.role === 'owner')).toHaveLength(1);
		expect(results.filter((r) => r.status === 204)).toHaveLength(1);
	});

	it('leaves one owner when they remove each other', async () => {
		const { alice, bob, project, la, lb, query } = await coOwners();

		await Promise.all([
			callHandler(removeProjectMember, {
				locals: la,
				method: 'DELETE',
				url: query,
				params: { id: project.id, userId: bob.id }
			}),
			callHandler(removeProjectMember, {
				locals: lb,
				method: 'DELETE',
				url: query,
				params: { id: project.id, userId: alice.id }
			})
		]);

		const members = await tp!.config.data.projects.listProjectMembers(SYSTEM_CONTEXT, project.id);
		expect(members.items.filter((m) => m.role === 'owner')).toHaveLength(1);
	});
});
