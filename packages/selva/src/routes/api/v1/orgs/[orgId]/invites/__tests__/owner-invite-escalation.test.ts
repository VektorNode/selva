/**
 * An invite is a second write path into `org_members`, so it needs the same
 * owner-only role gate that PATCH /orgs/{orgId}/members/{userId} enforces.
 *
 * Without it an org admin mints themselves an `owner` invite, accepts it (the
 * accept handler trusts the mint-time decision and cannot re-verify the
 * minter), and is then a second owner — which satisfies the sole-owner check
 * guarding removal of the founder. docs/contributing/permissions.md §3 says an owner survives any
 * admin coup; this is the coup.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import {
	freshProviders,
	seedAcme,
	seedOrgMember,
	seedUser,
	actAs,
	call,
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

describe('POST /api/v1/orgs/{orgId}/invites — org role ceiling', () => {
	it('refuses an owner invite minted by an admin', async () => {
		// `seedAcme` makes alice an *admin*, which is the whole point: she holds
		// `manage_org_members` and could previously mint any role.
		tp = await freshProviders();
		const { alice, acme } = await seedAcme(tp);
		const locals = await actAs(tp, alice.id);

		const res = await call(POST, {
			locals,
			params: { orgId: acme.id },
			body: { email: 'coup@acme.test', orgRole: 'owner', permissions: [] }
		});

		expect(res.status).toBe(403);

		const stored = await tp.config.data.invites.listByOrg(SYSTEM_CONTEXT, acme.id);
		expect(stored.items).toHaveLength(0);
	});

	it('refuses an admin invite minted by an admin', async () => {
		// Admin-minting-admin is the same escalation one step removed: the new
		// admin can mint further admins, and each one holds manage_org_members.
		tp = await freshProviders();
		const { alice, acme } = await seedAcme(tp);
		const locals = await actAs(tp, alice.id);

		const res = await call(POST, {
			locals,
			params: { orgId: acme.id },
			body: { email: 'second-admin@acme.test', orgRole: 'admin', permissions: [] }
		});

		expect(res.status).toBe(403);
	});

	it('allows an owner to mint an owner invite', async () => {
		tp = await freshProviders();
		const { acme } = await seedAcme(tp);
		const founder = await seedUser(tp, 'founder@acme.test');
		await seedOrgMember(tp, { orgId: acme.id, userId: founder.id, role: 'owner' });
		const locals = await actAs(tp, founder.id);

		const res = await call(POST, {
			locals,
			params: { orgId: acme.id },
			body: { email: 'cofounder@acme.test', orgRole: 'owner', permissions: [] }
		});

		expect(res.status).toBe(201);

		const stored = await tp.config.data.invites.listByOrg(SYSTEM_CONTEXT, acme.id);
		expect(stored.items[0]?.orgRole).toBe('owner');
	});

	it('still allows an admin to mint an ordinary member invite', async () => {
		// The gate must not break the common case an org admin is there to do.
		tp = await freshProviders();
		const { alice, acme } = await seedAcme(tp);
		const locals = await actAs(tp, alice.id);

		const res = await call(POST, {
			locals,
			params: { orgId: acme.id },
			body: { email: 'newhire@acme.test', orgRole: 'member', permissions: [] }
		});

		expect(res.status).toBe(201);
	});
});
