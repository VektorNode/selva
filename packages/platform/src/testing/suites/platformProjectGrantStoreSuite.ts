/**
 * Adapter conformance suite for IPlatformProjectGrantStore.
 *
 * Grants are hard-deleted (no soft-delete column). Tests cover the round-trip,
 * dedup on (projectId, granteeType, granteeId), and the cascade hooks
 * (`deleteByProject` + `deleteByGranteeOrg`).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { IPlatformProjectGrantStore } from '../../platformProjects/interface.js';
import type { PlatformProjectGrant } from '../../platformProjects/types.js';
import { SYSTEM_CONTEXT, type RequestContext } from '../../context.js';
import {
	makeExpectDenied,
	makeSeedHelpers,
	makeUuid,
	noopSeedUser,
	type SeedUserFn
} from './helpers.js';

export interface PlatformProjectGrantStoreConformanceOptions {
	name: string;
	createStore: () => Promise<IPlatformProjectGrantStore> | IPlatformProjectGrantStore;
	/**
	 * Optional hook for adapters with FK constraints to seed a `projects` row
	 * before the suite writes a grant that references it. Adapters without FKs
	 * (local JSON) can omit this.
	 */
	seedProject?: (projectId: string) => Promise<void>;
	/** Denials assert the `ProviderError` status (409 for a duplicate grant), not just a rejection. */
	strictDenials?: boolean;
	/**
	 * Run every case as an `instance_admin` user, the way the admin pages call the
	 * store, rather than as `SYSTEM_CONTEXT`.
	 */
	userCtx?: boolean;
	/** Supplies the `userCtx` admin on an adapter that checks it against a backend. */
	seedUser?: SeedUserFn;
}

function grant(overrides: Partial<PlatformProjectGrant> = {}): PlatformProjectGrant {
	return {
		id: overrides.id ?? makeUuid(),
		projectId: overrides.projectId ?? makeUuid(),
		granteeType: overrides.granteeType ?? 'org',
		granteeId: overrides.granteeId ?? makeUuid(),
		canSolve: overrides.canSolve ?? false,
		createdBy: overrides.createdBy ?? makeUuid(),
		createdAt: overrides.createdAt ?? new Date().toISOString()
	};
}

export function runPlatformProjectGrantStoreConformance(
	opts: PlatformProjectGrantStoreConformanceOptions
): void {
	const {
		name,
		createStore,
		seedProject,
		strictDenials = false,
		userCtx = false,
		seedUser = noopSeedUser
	} = opts;
	const expectDenied = makeExpectDenied(strictDenials);
	const users = makeSeedHelpers(seedUser);
	const seed = async (): Promise<string> => {
		const id = makeUuid();
		if (seedProject) await seedProject(id);
		return id;
	};

	describe(`IPlatformProjectGrantStore conformance: ${name}`, () => {
		let ctx: RequestContext = SYSTEM_CONTEXT;
		if (userCtx) {
			beforeEach(async () => {
				ctx = users.ctx(await users.seed(), { platformPermissions: ['instance_admin'] });
			});
		}

		it('create + listByProject round-trips the grant', async () => {
			const store = await createStore();
			const projectId = await seed();
			const g = grant({ projectId, granteeType: 'org', canSolve: true });
			await store.create(ctx, g);

			const got = await store.listByProject(ctx, projectId);
			expect(got).toHaveLength(1);
			expect(got[0].id).toBe(g.id);
			expect(got[0].canSolve).toBe(true);
			expect(got[0].granteeType).toBe('org');
		});

		it('listByProjects groups grants by project and keys every requested id', async () => {
			const store = await createStore();
			const p1 = await seed();
			const p2 = await seed();
			const p3 = await seed();
			await store.create(ctx, grant({ projectId: p1 }));
			await store.create(ctx, grant({ projectId: p1, granteeType: 'user' }));
			await store.create(ctx, grant({ projectId: p2 }));

			const got = await store.listByProjects(ctx, [p1, p2, p3]);
			expect(got.get(p1)).toHaveLength(2);
			expect(got.get(p2)).toHaveLength(1);
			// A project with no grants maps to an empty array, never undefined.
			expect(got.get(p3)).toEqual([]);
		});

		it('listByProjects returns an empty map for no ids', async () => {
			const store = await createStore();
			expect((await store.listByProjects(ctx, [])).size).toBe(0);
		});

		it('create rejects duplicate (projectId, granteeType, granteeId)', async () => {
			const store = await createStore();
			const projectId = await seed();
			const granteeId = makeUuid();
			await store.create(ctx, grant({ projectId, granteeType: 'org', granteeId }));
			await expectDenied(
				store.create(ctx, grant({ projectId, granteeType: 'org', granteeId })),
				409
			);
		});

		it('user and org grants for the same id coexist (different granteeType)', async () => {
			const store = await createStore();
			const projectId = await seed();
			const sharedId = makeUuid();
			await store.create(ctx, grant({ projectId, granteeType: 'org', granteeId: sharedId }));
			await store.create(ctx, grant({ projectId, granteeType: 'user', granteeId: sharedId }));
			const got = await store.listByProject(ctx, projectId);
			expect(got).toHaveLength(2);
		});

		it('delete removes the grant and listByProject no longer returns it', async () => {
			const store = await createStore();
			const projectId = await seed();
			const g = grant({ projectId });
			await store.create(ctx, g);
			await store.delete(ctx, g.id);

			const got = await store.listByProject(ctx, projectId);
			expect(got).toHaveLength(0);
		});

		it('deleteByProject removes every grant for that project', async () => {
			const store = await createStore();
			const target = await seed();
			const other = await seed();
			await store.create(ctx, grant({ projectId: target }));
			await store.create(ctx, grant({ projectId: target }));
			await store.create(ctx, grant({ projectId: other }));

			await store.deleteByProject(ctx, target);

			expect(await store.listByProject(ctx, target)).toHaveLength(0);
			expect(await store.listByProject(ctx, other)).toHaveLength(1);
		});

		it('deleteByProject is a no-op when no grants exist', async () => {
			const store = await createStore();
			await expect(store.deleteByProject(ctx, makeUuid())).resolves.toBeUndefined();
		});

		it('deleteByGranteeOrg removes only org grants matching the id, leaving user grants', async () => {
			const store = await createStore();
			const projectId = await seed();
			const orgId = makeUuid();
			const userId = makeUuid();
			await store.create(ctx, grant({ projectId, granteeType: 'org', granteeId: orgId }));
			await store.create(ctx, grant({ projectId, granteeType: 'user', granteeId: userId }));
			// A user grant whose granteeId happens to equal the orgId — must NOT be touched.
			await store.create(ctx, grant({ projectId, granteeType: 'user', granteeId: orgId }));

			await store.deleteByGranteeOrg(ctx, orgId);

			const remaining = await store.listByProject(ctx, projectId);
			expect(remaining).toHaveLength(2);
			expect(remaining.every((g) => g.granteeType === 'user')).toBe(true);
		});

		it('deleteByGranteeOrg is a no-op when no matching grants exist', async () => {
			const store = await createStore();
			await expect(store.deleteByGranteeOrg(ctx, makeUuid())).resolves.toBeUndefined();
		});
	});
}
