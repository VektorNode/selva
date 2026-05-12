/**
 * Adapter conformance suite for IPlatformProjectGrantStore.
 *
 * Grants are hard-deleted (no soft-delete column). Tests cover the round-trip,
 * dedup on (projectId, granteeType, granteeId), and the cascade hooks
 * (`deleteByProject` + `deleteByGranteeOrg`).
 */

import { describe, it, expect } from 'vitest';
import type { IPlatformProjectGrantStore } from '../../platformProjects/interface.js';
import type { PlatformProjectGrant } from '../../platformProjects/types.js';
import { SYSTEM_CONTEXT } from '../../context.js';
import { makeUuid } from './helpers.js';

export interface PlatformProjectGrantStoreConformanceOptions {
	name: string;
	createStore: () => Promise<IPlatformProjectGrantStore> | IPlatformProjectGrantStore;
	/**
	 * Optional hook for adapters with FK constraints to seed a `projects` row
	 * before the suite writes a grant that references it. Adapters without FKs
	 * (local JSON) can omit this.
	 */
	seedProject?: (projectId: string) => Promise<void>;
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
	const { name, createStore, seedProject } = opts;
	const seed = async (): Promise<string> => {
		const id = makeUuid();
		if (seedProject) await seedProject(id);
		return id;
	};

	describe(`IPlatformProjectGrantStore conformance: ${name}`, () => {
		it('create + listByProject round-trips the grant', async () => {
			const store = await createStore();
			const projectId = await seed();
			const g = grant({ projectId, granteeType: 'org', canSolve: true });
			await store.create(SYSTEM_CONTEXT, g);

			const got = await store.listByProject(SYSTEM_CONTEXT, projectId);
			expect(got).toHaveLength(1);
			expect(got[0].id).toBe(g.id);
			expect(got[0].canSolve).toBe(true);
			expect(got[0].granteeType).toBe('org');
		});

		it('listByProject scopes to the requested project', async () => {
			const store = await createStore();
			const p1 = await seed();
			const p2 = await seed();
			await store.create(SYSTEM_CONTEXT, grant({ projectId: p1 }));
			await store.create(SYSTEM_CONTEXT, grant({ projectId: p2 }));

			const got = await store.listByProject(SYSTEM_CONTEXT, p1);
			expect(got).toHaveLength(1);
			expect(got[0].projectId).toBe(p1);
		});

		it('create rejects duplicate (projectId, granteeType, granteeId)', async () => {
			const store = await createStore();
			const projectId = await seed();
			const granteeId = makeUuid();
			await store.create(SYSTEM_CONTEXT, grant({ projectId, granteeType: 'org', granteeId }));
			await expect(
				store.create(SYSTEM_CONTEXT, grant({ projectId, granteeType: 'org', granteeId }))
			).rejects.toThrow();
		});

		it('user and org grants for the same id coexist (different granteeType)', async () => {
			const store = await createStore();
			const projectId = await seed();
			const sharedId = makeUuid();
			await store.create(
				SYSTEM_CONTEXT,
				grant({ projectId, granteeType: 'org', granteeId: sharedId })
			);
			await store.create(
				SYSTEM_CONTEXT,
				grant({ projectId, granteeType: 'user', granteeId: sharedId })
			);
			const got = await store.listByProject(SYSTEM_CONTEXT, projectId);
			expect(got).toHaveLength(2);
		});

		it('delete removes the grant and listByProject no longer returns it', async () => {
			const store = await createStore();
			const projectId = await seed();
			const g = grant({ projectId });
			await store.create(SYSTEM_CONTEXT, g);
			await store.delete(SYSTEM_CONTEXT, g.id);

			const got = await store.listByProject(SYSTEM_CONTEXT, projectId);
			expect(got).toHaveLength(0);
		});

		it('delete on unknown id throws', async () => {
			const store = await createStore();
			await expect(store.delete(SYSTEM_CONTEXT, makeUuid())).rejects.toThrow();
		});

		it('deleteByProject removes every grant for that project', async () => {
			const store = await createStore();
			const target = await seed();
			const other = await seed();
			await store.create(SYSTEM_CONTEXT, grant({ projectId: target }));
			await store.create(SYSTEM_CONTEXT, grant({ projectId: target }));
			await store.create(SYSTEM_CONTEXT, grant({ projectId: other }));

			await store.deleteByProject(SYSTEM_CONTEXT, target);

			expect(await store.listByProject(SYSTEM_CONTEXT, target)).toHaveLength(0);
			expect(await store.listByProject(SYSTEM_CONTEXT, other)).toHaveLength(1);
		});

		it('deleteByProject is a no-op when no grants exist', async () => {
			const store = await createStore();
			await expect(store.deleteByProject(SYSTEM_CONTEXT, makeUuid())).resolves.toBeUndefined();
		});

		it('deleteByGranteeOrg removes only org grants matching the id, leaving user grants', async () => {
			const store = await createStore();
			const projectId = await seed();
			const orgId = makeUuid();
			const userId = makeUuid();
			await store.create(
				SYSTEM_CONTEXT,
				grant({ projectId, granteeType: 'org', granteeId: orgId })
			);
			await store.create(
				SYSTEM_CONTEXT,
				grant({ projectId, granteeType: 'user', granteeId: userId })
			);
			// A user grant whose granteeId happens to equal the orgId — must NOT be touched.
			await store.create(
				SYSTEM_CONTEXT,
				grant({ projectId, granteeType: 'user', granteeId: orgId })
			);

			await store.deleteByGranteeOrg(SYSTEM_CONTEXT, orgId);

			const remaining = await store.listByProject(SYSTEM_CONTEXT, projectId);
			expect(remaining).toHaveLength(2);
			expect(remaining.every((g) => g.granteeType === 'user')).toBe(true);
		});

		it('deleteByGranteeOrg is a no-op when no matching grants exist', async () => {
			const store = await createStore();
			await expect(store.deleteByGranteeOrg(SYSTEM_CONTEXT, makeUuid())).resolves.toBeUndefined();
		});
	});
}
