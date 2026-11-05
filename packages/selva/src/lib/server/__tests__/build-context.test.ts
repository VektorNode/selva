/**
 * Direct tests for `buildRequestContext`, which the hook builds every
 * session context through. The
 * fixture's `actAs()` reimplements this logic in parallel — a drift risk —
 * so these tests pin the real function against real local stores AND assert
 * it agrees with `actAs()`, so the two can't silently diverge.
 *
 * `buildRequestContext` is a pure function of its inputs (`platformPermissions` +
 * `membership`); these tests fetch those the same way the hook does and feed
 * them in.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SYSTEM_CONTEXT, type AuthUser, type PlatformPermission } from '@selvajs/platform';
import { buildRequestContext } from '@selvajs/server/http';
import {
	freshProviders,
	seedUser,
	seedOrg,
	seedOrgMember,
	actAs,
	type TestProviders
} from './fixtures.js';

let tp: TestProviders | null = null;

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

/** Fetch the two data-layer inputs the hook passes into buildRequestContext. */
async function bootstrapInputs(t: TestProviders, userId: string) {
	const [platformPermissions, membership] = await Promise.all([
		t.config.data.permissions.getFor(SYSTEM_CONTEXT, userId),
		t.config.data.orgs.findUserMembership(SYSTEM_CONTEXT, userId)
	]);
	return { platformPermissions, membership };
}

/** The call the hook makes. */
function buildContext(
	t: TestProviders,
	user: AuthUser,
	sessionToken: string | undefined,
	platformPermissions: PlatformPermission[],
	membership: Awaited<ReturnType<typeof bootstrapInputs>>['membership'],
	pinOrg?: boolean
) {
	return buildRequestContext(
		{ user, sessionToken, platformPermissions, membership: membership?.member ?? null, pinOrg },
		{ orgs: t.config.data.orgs }
	);
}

function userFrom(seed: { id: string; email: string }): AuthUser {
	return {
		id: seed.id,
		email: seed.email,
		createdAt: new Date().toISOString(),
		disabled: false
	};
}

describe('buildRequestContext', () => {
	it('resolves acting org + org permissions from a membership', async () => {
		tp = await freshProviders();
		const alice = await seedUser(tp, 'alice@acme.test');
		const org = await seedOrg(tp, { name: 'Acme', slug: 'acme', ownerId: alice.id });
		await seedOrgMember(tp, { orgId: org.id, userId: alice.id, role: 'owner' });

		const { platformPermissions, membership } = await bootstrapInputs(tp, alice.id);
		const ctx = await buildContext(tp, userFrom(alice), 'tok', platformPermissions, membership);

		expect(ctx.userId).toBe(alice.id);
		expect(ctx.actingOrgId).toBe(org.id);
		expect(ctx.orgPermissions.length).toBeGreaterThan(0);
		expect(ctx.adapterContext).toEqual({ sessionToken: 'tok' });
	});

	it('leaves a plain member with no org unattached (no admin fallback)', async () => {
		tp = await freshProviders();
		const nobody = await seedUser(tp, 'nobody@acme.test');

		const { platformPermissions, membership } = await bootstrapInputs(tp, nobody.id);
		const ctx = await buildContext(
			tp,
			userFrom(nobody),
			undefined,
			platformPermissions,
			membership
		);

		expect(ctx.actingOrgId).toBeUndefined();
		expect(ctx.orgPermissions).toEqual([]);
		expect(ctx.platformPermissions).toEqual([]);
		// No session token → no adapterContext.
		expect(ctx.adapterContext).toBeUndefined();
	});

	it('falls back to the first org for an instance admin without a membership', async () => {
		tp = await freshProviders();
		// An org exists (owned by someone else); the admin is a member of none.
		const owner = await seedUser(tp, 'owner@acme.test');
		const org = await seedOrg(tp, { name: 'Acme', slug: 'acme', ownerId: owner.id });
		const admin = await seedUser(tp, 'admin@acme.test', ['instance_admin']);

		const { platformPermissions, membership } = await bootstrapInputs(tp, admin.id);
		expect(membership).toBeNull();
		const ctx = await buildContext(tp, userFrom(admin), 'tok', platformPermissions, membership);

		expect(ctx.platformPermissions).toContain('instance_admin');
		expect(ctx.actingOrgId).toBe(org.id); // fell back to the only org
		expect(ctx.orgPermissions).toEqual([]); // fallback grants no org perms
	});

	it('a pinned context never falls back to another org', async () => {
		tp = await freshProviders();
		const owner = await seedUser(tp, 'owner@acme.test');
		await seedOrg(tp, { name: 'Acme', slug: 'acme', ownerId: owner.id });
		const admin = await seedUser(tp, 'admin@acme.test', ['instance_admin']);

		const { platformPermissions, membership } = await bootstrapInputs(tp, admin.id);
		const ctx = await buildContext(
			tp,
			userFrom(admin),
			undefined,
			platformPermissions,
			membership,
			true
		);

		expect(ctx.actingOrgId).toBeUndefined();
	});

	it('agrees with the fixture actAs() reimplementation (drift guard)', async () => {
		tp = await freshProviders();
		const alice = await seedUser(tp, 'alice@acme.test');
		const org = await seedOrg(tp, { name: 'Acme', slug: 'acme', ownerId: alice.id });
		await seedOrgMember(tp, { orgId: org.id, userId: alice.id, role: 'admin' });

		const { platformPermissions, membership } = await bootstrapInputs(tp, alice.id);
		const prod = await buildContext(
			tp,
			userFrom(alice),
			undefined,
			platformPermissions,
			membership
		);
		const { ctx: fixture } = await actAs(tp, alice.id);

		expect(prod.userId).toBe(fixture.userId);
		expect(prod.actingOrgId).toBe(fixture.actingOrgId);
		expect(prod.platformPermissions).toEqual(fixture.platformPermissions);
		expect(prod.orgPermissions).toEqual(fixture.orgPermissions);
	});
});
