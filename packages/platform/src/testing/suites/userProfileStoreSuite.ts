/**
 * Adapter conformance suite for IUserProfileStore: display name, starred
 * definitions and recent runs, scoped to the user themselves.
 */

import { describe, it, expect } from 'vitest';
import type { IUserProfileStore } from '../../userProfile/interface.js';
import type { AuthUser } from '../../auth/index.js';
import { MAX_RECENT_RUNS, type RecentRun } from '../../userProfile/index.js';
import { SYSTEM_CONTEXT } from '../../context.js';
import { makeCtx, makeExpectDenied, makeUuid } from './helpers.js';

// SYSTEM_CONTEXT, so most cases don't need a ctx minted per user. The scoping case
// below builds its own.
const ctx = SYSTEM_CONTEXT;

export interface UserProfileStoreConformanceOptions {
	/** Name to show in test output. */
	name: string;
	/**
	 * Factory that returns a fresh, empty store and a `seedUser(email)` helper
	 * that creates a real user the test can mutate. The helper is provider-
	 * specific because IUserProfileStore itself doesn't create users.
	 */
	createStore: () => Promise<{
		store: IUserProfileStore;
		seedUser: (email: string) => Promise<AuthUser>;
	}>;
	/** Denials assert `ProviderError(403)`, not just a rejection. */
	strictDenials?: boolean;
	/** A user reads and changes their own profile through a ctx with no permissions. */
	selfAccess?: boolean;
	/** `recordRun` keeps exactly `MAX_RECENT_RUNS` entries, not just fewer than it was given. */
	recentRunsCap?: boolean;
}

function run(definitionId: string, timestamp = new Date().toISOString()): RecentRun {
	return { definitionId, runId: makeUuid(), definitionName: 'D', timestamp };
}

export function runUserProfileStoreConformance(opts: UserProfileStoreConformanceOptions): void {
	const {
		name,
		createStore,
		strictDenials = false,
		selfAccess = false,
		recentRunsCap = false
	} = opts;
	const expectDenied = makeExpectDenied(strictDenials);
	const plainCtx = (userId: string) =>
		makeCtx(userId, { platformPermissions: [], orgPermissions: [] });

	describe(`IUserProfileStore conformance: ${name}`, () => {
		it('a user cannot read or change someone else through a plain ctx', async () => {
			const { store, seedUser } = await createStore();
			const victim = await seedUser('victim@example.com');
			const other = plainCtx(makeUuid());

			await expectDenied(store.getProfile(other, victim.id), 403);
			await expectDenied(store.updateProfile(other, victim.id, { displayName: 'Hacked' }), 403);
		});

		if (selfAccess) {
			it('a user reads and changes their own profile through a plain ctx', async () => {
				const { store, seedUser } = await createStore();
				const user = await seedUser('self@example.com');
				const own = plainCtx(user.id);

				expect(await store.updateProfile(own, user.id, { displayName: 'Me' })).toBe('ok');
				expect((await store.getProfile(own, user.id))?.displayName).toBe('Me');
			});
		}

		it('recordRun keeps one entry per definition, newest first', async () => {
			const { store, seedUser } = await createStore();
			const user = await seedUser('dedupe@example.com');
			const a = makeUuid();
			const b = makeUuid();

			expect(await store.recordRun(ctx, user.id, run(a, '2026-01-01T00:00:00.000Z'))).toBe('ok');
			await store.recordRun(ctx, user.id, run(b, '2026-01-02T00:00:00.000Z'));
			await store.recordRun(ctx, user.id, run(a, '2026-01-03T00:00:00.000Z'));

			const profile = await store.getProfile(ctx, user.id);
			expect(profile?.recentRuns.map((r) => r.definitionId)).toEqual([a, b]);
		});

		it('recordRun caps the list', async () => {
			const { store, seedUser } = await createStore();
			const user = await seedUser('cap@example.com');
			const given = MAX_RECENT_RUNS + 10;

			for (let i = 0; i < given; i++) {
				await store.recordRun(ctx, user.id, run(makeUuid(), new Date(i).toISOString()));
			}

			const profile = await store.getProfile(ctx, user.id);
			if (recentRunsCap) expect(profile?.recentRuns).toHaveLength(MAX_RECENT_RUNS);
			else expect(profile?.recentRuns.length).toBeLessThan(given);
		});

		it('getProfile returns null for unknown user', async () => {
			const { store } = await createStore();
			const profile = await store.getProfile(ctx, makeUuid());
			expect(profile).toBeNull();
		});

		it('getProfile returns a profile for a seeded user', async () => {
			const { store, seedUser } = await createStore();
			const user = await seedUser('get@example.com');
			const profile = await store.getProfile(ctx, user.id);
			expect(profile).toBeTruthy();
			expect(profile?.userId).toBe(user.id);
			expect(profile?.starredDefinitions).toEqual([]);
			expect(profile?.recentRuns).toEqual([]);
		});

		it('getProfiles batch-loads seeded users and skips unknowns', async () => {
			const { store, seedUser } = await createStore();
			const a = await seedUser('a-batch@example.com');
			const b = await seedUser('b-batch@example.com');
			const ghost = makeUuid();
			const profiles = await store.getProfiles(ctx, [a.id, b.id, ghost]);
			const ids = new Set(profiles.map((p) => p.userId));
			expect(ids.has(a.id)).toBe(true);
			expect(ids.has(b.id)).toBe(true);
			expect(ids.has(ghost)).toBe(false);
		});

		it('updateProfile changes displayName and getProfile returns it', async () => {
			const { store, seedUser } = await createStore();
			const user = await seedUser('p@example.com');
			const result = await store.updateProfile(ctx, user.id, { displayName: 'Felix' });
			expect(result).toBe('ok');
			const profile = await store.getProfile(ctx, user.id);
			expect(profile?.displayName).toBe('Felix');
		});

		it('updateProfile returns not_found for unknown user', async () => {
			const { store } = await createStore();
			const result = await store.updateProfile(ctx, makeUuid(), { displayName: 'X' });
			expect(result).toBe('not_found');
		});

		it('starDefinition + unstarDefinition round-trip reflects in profile', async () => {
			const { store, seedUser } = await createStore();
			const user = await seedUser('star@example.com');
			const defId = makeUuid();
			expect(await store.starDefinition(ctx, user.id, defId)).toBe('ok');
			expect((await store.getProfile(ctx, user.id))?.starredDefinitions).toContain(defId);
			expect(await store.unstarDefinition(ctx, user.id, defId)).toBe('ok');
			expect((await store.getProfile(ctx, user.id))?.starredDefinitions).not.toContain(defId);
		});

		it('starDefinition is idempotent (no duplicates)', async () => {
			const { store, seedUser } = await createStore();
			const user = await seedUser('idem@example.com');
			const defId = makeUuid();
			expect(await store.starDefinition(ctx, user.id, defId)).toBe('ok');
			expect(await store.starDefinition(ctx, user.id, defId)).toBe('ok');
			const profile = await store.getProfile(ctx, user.id);
			const occurrences = profile?.starredDefinitions.filter((d) => d === defId).length;
			expect(occurrences).toBe(1);
		});

		it('recordRun returns not_found for unknown user', async () => {
			const { store } = await createStore();
			expect(await store.recordRun(ctx, makeUuid(), run(makeUuid()))).toBe('not_found');
		});

		it('starDefinition returns not_found for unknown user', async () => {
			const { store } = await createStore();
			expect(await store.starDefinition(ctx, makeUuid(), makeUuid())).toBe('not_found');
		});
	});
}
