/**
 * Finding 18 — the loader's catch swallowed everything.
 *
 * It wrapped four provider calls (`listUsers`, `getProfiles`, `getForBatch`,
 * `listAllOrgMembers`), re-threw only on a `status` field, and logged nothing.
 * Two consequences: a permission denial rendered as "User store unavailable"
 * (because `ProviderError` carries `statusCode`, not `status`), and any real
 * outage rendered as the same wiring message.
 *
 * `users: null` still legitimately means "this provider exposes no user store",
 * which is why the distinction has to be tested rather than assumed.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ProviderError } from '@selvajs/platform';
import {
	freshProviders,
	seedUser,
	seedOrg,
	seedOrgMember,
	actAs,
	type TestProviders
} from '$lib/server/__tests__/fixtures.js';
import { getLogger } from '$lib/server/providers.server';
import { load } from '../+page.server.js';

let tp: TestProviders | null = null;

afterEach(async () => {
	vi.restoreAllMocks();
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

type LoadResult = { users: unknown[] | null };

async function runLoad(locals: unknown): Promise<LoadResult> {
	return (await load({ locals } as Parameters<typeof load>[0])) as LoadResult;
}

/** A `manage_instance_users` holder — the role this page exists to serve. */
async function seedUserAdmin() {
	const admin = await seedUser(tp!, 'useradmin@acme.test', ['manage_instance_users']);
	const org = await seedOrg(tp!, { name: 'Acme', slug: 'acme', ownerId: admin.id });
	await seedOrgMember(tp!, { orgId: org.id, userId: admin.id, role: 'admin' });
	return admin;
}

describe('/admin/users load error handling', () => {
	it('lists users for a manage_instance_users holder', async () => {
		tp = await freshProviders();
		const admin = await seedUserAdmin();

		const locals = await actAs(tp, admin.id);
		const { users } = await runLoad(locals);

		// §8's role runs this page. If the permission store denied it, this is
		// where that shows up — as a null list, not an error.
		expect(users).not.toBeNull();
		expect(users!.length).toBeGreaterThan(0);
	});

	it('propagates a provider denial as its own status instead of an empty page', async () => {
		tp = await freshProviders();
		const admin = await seedUserAdmin();

		vi.spyOn(tp.config.data.permissions, 'getForBatch').mockRejectedValue(
			new ProviderError('Forbidden: instance admin required', 403)
		);

		const locals = await actAs(tp, admin.id);
		// The old catch checked `status`; ProviderError carries `statusCode`, so
		// this denial fell through and rendered as "configure DATA_PATH".
		await expect(runLoad(locals)).rejects.toMatchObject({ status: 403 });
	});

	it('logs an unexpected provider failure rather than swallowing it', async () => {
		tp = await freshProviders();
		const admin = await seedUserAdmin();

		vi.spyOn(tp.config.data.orgs, 'listOrgMembers').mockRejectedValue(
			new Error('connection reset')
		);
		// The test mock returns one shared logger instance, so a spy here sees what
		// the loader logs through its own `getLogger()` call.
		const logged = vi.spyOn(getLogger(), 'error');

		const locals = await actAs(tp, admin.id);
		const { users } = await runLoad(locals);

		// The page still degrades to the empty state — but it is no longer silent.
		expect(users).toBeNull();
		expect(logged).toHaveBeenCalled();
	});
});
