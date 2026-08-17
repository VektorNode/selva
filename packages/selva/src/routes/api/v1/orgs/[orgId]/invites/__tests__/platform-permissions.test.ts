/**
 * Invites carry instance-wide permissions, and that makes the mint route an
 * escalation surface: `manage_org_members` is enough to invite people, so
 * without a second check an org admin could mint themselves an `instance_admin`
 * invite and accept it.
 *
 * This capability is the reason the admin-sets-password form could be removed —
 * it is now the only way to create a second instance admin on a deployment
 * whose provider owns credentials.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import {
	freshProviders,
	seedAcme,
	actAs,
	call,
	grantPlatformPermissions,
	type TestProviders
} from '$lib/server/__tests__/fixtures.js';
import { POST } from '../+server.js';

let tp: TestProviders | null = null;

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

describe('POST /api/v1/orgs/{orgId}/invites — platform permissions', () => {
	it('stores platform permissions when an instance admin mints the invite', async () => {
		tp = await freshProviders();
		const { alice, acme } = await seedAcme(tp);
		await grantPlatformPermissions(tp, alice.id, ['instance_admin']);
		const locals = await actAs(tp, alice.id);

		const res = await call(POST, {
			locals,
			params: { orgId: acme.id },
			body: {
				email: 'second-admin@acme.test',
				orgRole: 'member',
				permissions: ['instance_admin']
			}
		});

		expect(res.status).toBe(201);
		const { id } = res.json as { id: string };
		const stored = await tp.config.data.invites.listByOrg(SYSTEM_CONTEXT, acme.id);
		const row = stored.items.find((i) => i.id === id);
		expect(row?.platformPermissions).toEqual(['instance_admin']);
	});

	it('refuses an invite from someone who cannot manage org members at all', async () => {
		// Bob is a plain `member`, so `requireManageOrgMembers` stops him at the
		// door — this asserts the first gate, NOT the delegation guard behind it.
		// That distinction is covered in `platform-permission-delegation.test.ts`,
		// which acts as an org owner: someone who clears this gate and must still
		// be refused the platform scope.
		tp = await freshProviders();
		const { bob, acme } = await seedAcme(tp);
		const locals = await actAs(tp, bob.id);

		const res = await call(POST, {
			locals,
			params: { orgId: acme.id },
			body: { email: 'escalation@acme.test', orgRole: 'member', permissions: ['instance_admin'] }
		});

		expect(res.status).toBe(403);
	});

	it('leaves platform permissions empty on an ordinary org invite', async () => {
		// The common case must not pick anything up by default — an invite is
		// org-scope unless someone deliberately ticked an instance box.
		tp = await freshProviders();
		const { alice, acme } = await seedAcme(tp);
		await grantPlatformPermissions(tp, alice.id, ['instance_admin']);
		const locals = await actAs(tp, alice.id);

		const res = await call(POST, {
			locals,
			params: { orgId: acme.id },
			body: {
				email: 'newhire@acme.test',
				orgRole: 'member',
				permissions: ['manage_definitions']
			}
		});

		expect(res.status).toBe(201);
		const { id } = res.json as { id: string };
		const stored = await tp.config.data.invites.listByOrg(SYSTEM_CONTEXT, acme.id);
		const row = stored.items.find((i) => i.id === id);
		expect(row?.platformPermissions).toEqual([]);
		expect(row?.orgPermissions).toContain('manage_definitions');
	});
});
