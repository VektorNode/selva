/**
 * Platform scope is not delegable, and three routes write it.
 *
 * `manage_org_members` mints invites, `manage_instance_users` creates and
 * edits users; neither may hand out `instance_admin`, or the holder
 * self-elevates past the role that granted it. That rule lived in three
 * hand-written copies before it became `assertCanGrantPlatformPermissions`.
 *
 * Every case here acts as someone who passes the route's own gate and still
 * must be refused — a plain org member is rejected by `requireManageOrgMembers`
 * before the delegation guard ever runs, so a test using one would stay green
 * even with the guard disabled. Disabling the guard must turn these red.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
	freshProviders,
	seedAcme,
	seedUser,
	seedOrg,
	seedOrgMember,
	actAs,
	call,
	grantPlatformPermissions,
	type TestProviders
} from '$lib/server/__tests__/fixtures.js';
import { POST as MINT_INVITE } from '../../../routes/api/v1/orgs/[orgId]/invites/+server.js';
import { POST as CREATE_USER } from '../../../routes/api/admin/users/+server.js';
import { PATCH as EDIT_USER } from '../../../routes/api/admin/users/[id]/+server.js';

let tp: TestProviders | null = null;

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

/** Holds `manage_org_members`, so the mint route's gates both pass. */
async function seedOrgOwner() {
	const { acme } = await seedAcme(tp!);
	const owner = await seedUser(tp!, 'owner@acme.test');
	await seedOrgMember(tp!, { orgId: acme.id, userId: owner.id, role: 'owner' });
	return { acme, owner };
}

/** Runs /admin/users; holds no `instance_admin`. */
async function seedUserAdmin() {
	const admin = await seedUser(tp!, 'useradmin@acme.test', ['manage_instance_users']);
	const org = await seedOrg(tp!, { name: 'Acme', slug: 'acme', ownerId: admin.id });
	await seedOrgMember(tp!, { orgId: org.id, userId: admin.id, role: 'admin' });
	return { admin, org };
}

describe('platform-scope permissions are not delegable', () => {
	it('an org owner cannot mint an invite carrying instance_admin', async () => {
		tp = await freshProviders();
		const { acme, owner } = await seedOrgOwner();
		const locals = await actAs(tp, owner.id);

		const res = await call(MINT_INVITE, {
			locals,
			params: { orgId: acme.id },
			body: {
				email: 'escalation@acme.test',
				orgRole: 'member',
				permissions: ['instance_admin']
			}
		});

		// The owner clears `requireManageOrgMembers` and the owner-only role gate.
		// Only the delegation guard stands between them and a minted admin.
		expect(res.status).toBe(403);
	});

	it('an org owner can still mint an ordinary org invite', async () => {
		tp = await freshProviders();
		const { acme, owner } = await seedOrgOwner();
		const locals = await actAs(tp, owner.id);

		const res = await call(MINT_INVITE, {
			locals,
			params: { orgId: acme.id },
			body: {
				email: 'newhire@acme.test',
				orgRole: 'member',
				permissions: ['manage_definitions']
			}
		});

		// The control: an empty platform set is a `manage_org_members` operation,
		// so the guard must not turn the common case into a 403.
		expect(res.status).toBe(201);
	});

	it('manage_instance_users cannot create a user holding instance_admin', async () => {
		tp = await freshProviders();
		const { admin } = await seedUserAdmin();
		const locals = await actAs(tp, admin.id);

		const res = await call(CREATE_USER, {
			locals,
			body: { email: 'confederate@acme.test', permissions: ['instance_admin'] }
		});

		expect(res.status).toBe(403);
	});

	it('manage_instance_users cannot grant instance_admin to an existing user', async () => {
		tp = await freshProviders();
		const { admin, org } = await seedUserAdmin();
		const target = await seedUser(tp, 'target@acme.test');
		await seedOrgMember(tp, { orgId: org.id, userId: target.id, role: 'member' });
		const locals = await actAs(tp, admin.id);

		const res = await call(EDIT_USER, {
			locals,
			params: { id: target.id },
			body: { permissions: ['instance_admin'] }
		});

		expect(res.status).toBe(403);
	});

	it('manage_instance_users cannot revoke an existing admin’s permissions', async () => {
		tp = await freshProviders();
		const { admin, org } = await seedUserAdmin();
		const target = await seedUser(tp, 'realadmin@acme.test', ['instance_admin']);
		await seedOrgMember(tp, { orgId: org.id, userId: target.id, role: 'member' });
		const locals = await actAs(tp, admin.id);

		const res = await call(EDIT_USER, {
			locals,
			params: { id: target.id },
			body: { permissions: [] }
		});

		// Revoking is a platform-scope change too — otherwise the user-admin role
		// strips the admins above it and the instance is left with none.
		expect(res.status).toBe(403);
	});

	it('an instance admin may grant platform scope', async () => {
		tp = await freshProviders();
		const { admin, org } = await seedUserAdmin();
		await grantPlatformPermissions(tp, admin.id, ['manage_instance_users', 'instance_admin']);
		const target = await seedUser(tp, 'promote-me@acme.test');
		await seedOrgMember(tp, { orgId: org.id, userId: target.id, role: 'member' });
		const locals = await actAs(tp, admin.id);

		const res = await call(EDIT_USER, {
			locals,
			params: { id: target.id },
			body: { permissions: ['instance_admin'] }
		});

		expect(res.status).toBe(204);
		const stored = await tp.config.data.permissions.getFor(locals.ctx, target.id);
		expect(stored).toContain('instance_admin');
	});
});
