/**
 * Finding 19 — the sole-`instance_admin` lock was computed client-side over the
 * loaded page, and `listUsers` caps at 200.
 *
 * On an instance with more users than that, a second admin can sit past the cut,
 * the page counts one, and the UI locks a row the server would happily release —
 * or, with the page ordered the other way, unlocks the row that really is the
 * last admin. Either way the §2 invariant is mirrored from truncated input.
 *
 * The count now comes from the permission store, which reads every row. These
 * tests assert the loader's number, not the page's — that is the whole fix.
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
import { load } from '../+page.server.js';

let tp: TestProviders | null = null;

afterEach(async () => {
	vi.restoreAllMocks();
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

type LoadResult = { users: unknown[] | null; enabledInstanceAdminCount: number | null };

async function runLoad(locals: unknown): Promise<LoadResult> {
	return (await load({ locals } as Parameters<typeof load>[0])) as LoadResult;
}

async function seedInstance(adminPermissions: string[][]) {
	const users = [];
	for (const [i, perms] of adminPermissions.entries()) {
		users.push(await seedUser(tp!, `u${i}@acme.test`, perms as Parameters<typeof seedUser>[2]));
	}
	const org = await seedOrg(tp!, { name: 'Acme', slug: 'acme', ownerId: users[0].id });
	for (const u of users) {
		await seedOrgMember(tp!, { orgId: org.id, userId: u.id, role: 'admin' });
	}
	return users;
}

describe('/admin/users sole-instance-admin count', () => {
	it('reports one when the instance has a single admin', async () => {
		tp = await freshProviders();
		const [admin] = await seedInstance([['instance_admin'], []]);

		const locals = await actAs(tp, admin.id);
		const { enabledInstanceAdminCount } = await runLoad(locals);

		expect(enabledInstanceAdminCount).toBe(1);
	});

	it('reports the true count, not the count of admins on the loaded page', async () => {
		tp = await freshProviders();
		const [admin] = await seedInstance([['instance_admin'], ['instance_admin']]);

		// The page-derived version counted whatever `listUsers` returned. Capping
		// that read to one row is the shape of a 200-row truncation on a larger
		// instance: the second admin exists, and the count must still see them.
		const authProvider = tp.config.auth;
		const realListUsers = authProvider.listUsers!.bind(authProvider);
		vi.spyOn(authProvider, 'listUsers').mockImplementation(async () => {
			const page = await realListUsers({ limit: 200 });
			return page ? { ...page, items: page.items.slice(0, 1) } : page;
		});

		const locals = await actAs(tp, admin.id);
		const { users, enabledInstanceAdminCount } = await runLoad(locals);

		expect(users).toHaveLength(1);
		expect(enabledInstanceAdminCount).toBe(2);
	});

	it('degrades to null rather than locking when the count fails', async () => {
		tp = await freshProviders();
		const [admin] = await seedInstance([['instance_admin'], []]);

		vi.spyOn(tp.config.data.permissions, 'countInstanceAdminsExcluding').mockRejectedValue(
			new ProviderError('boom', 500)
		);

		const locals = await actAs(tp, admin.id);
		const { users, enabledInstanceAdminCount } = await runLoad(locals);

		// A failed count must not become a lock: the server refuses the removal
		// either way, and a lock the operator cannot explain is worse than a
		// button that returns a clear 409.
		expect(users).not.toBeNull();
		expect(enabledInstanceAdminCount).toBeNull();
	});
});
