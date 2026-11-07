/**
 * Adapter conformance suite for `IDataProvider.onUserDeleted`: what erasure
 * removes, and what it leaves for the people still there. Each case runs the
 * delete the way the admin route does: identity first, then the data hook.
 */

import { describe, it, expect } from 'vitest';
import type { IApiTokenStore } from '../../apiTokens/interface.js';
import type { IDataProvider } from '../../data/interface.js';
import { ERASED_ACTOR_ID } from '../../data/interface.js';
import type { Invite } from '../../invites/types.js';
import { SYSTEM_CONTEXT as S } from '../../context.js';
import { makeUuid, noopSeedUser, randomSlug, type SeedUserFn } from './helpers.js';

export interface UserErasureConformanceOptions {
	name: string;
	/** A fresh provider per test, with `apiTokens` wired. */
	createProvider: () => Promise<IDataProvider> | IDataProvider;
	/** Seeds a user the stores can reference. The returned id is the one the suite uses. */
	seedUser?: SeedUserFn;
	/**
	 * Deletes the user's identity, as the delete route does before calling
	 * `onUserDeleted`. Needed where erasure leans on cascades from the auth row
	 * (Supabase FKs to `auth.users`).
	 */
	deleteIdentity?: (userId: string) => Promise<void>;
}

const DAY = 24 * 60 * 60 * 1000;

interface World {
	data: IDataProvider;
	apiTokens: IApiTokenStore;
	leaver: string;
	colleague: string;
	/** The leaver's address in the case their identity provider reports it. */
	email: string;
	orgId: string;
	projectId: string;
	inviteToThem: Invite;
	inviteFromThem: Invite;
	inviteToBystander: Invite;
	tokenHash: string;
}

export function runUserErasureConformance(opts: UserErasureConformanceOptions): void {
	const { name, createProvider, seedUser = noopSeedUser, deleteIdentity } = opts;

	async function seed(): Promise<string> {
		return (await seedUser(makeUuid())).userId;
	}

	function invite(orgId: string, invitedBy: string, email: string): Invite {
		const now = Date.now();
		return {
			id: makeUuid(),
			tokenHash: `hash-${makeUuid()}`,
			// The invite route stores addresses lowercased.
			email: email.toLowerCase(),
			orgId,
			orgRole: 'member',
			orgPermissions: [],
			invitedBy,
			createdAt: new Date(now).toISOString(),
			expiresAt: new Date(now + DAY).toISOString()
		};
	}

	async function buildWorld(): Promise<World> {
		const data = await createProvider();
		const apiTokens = data.apiTokens;
		if (!apiTokens) throw new Error('runUserErasureConformance needs a provider with apiTokens');

		const leaver = await seed();
		const colleague = await seed();
		await data.ensureUser(S, leaver);
		await data.ensureUser(S, colleague);
		await data.userProfile.updateProfile(S, leaver, { displayName: 'Leaver' });

		const now = new Date().toISOString();
		const orgId = makeUuid();
		await data.orgs.createOrg(S, {
			id: orgId,
			name: 'Erasure Org',
			slug: randomSlug('erasure'),
			ownerId: leaver,
			createdBy: leaver,
			updatedBy: leaver,
			createdAt: now,
			updatedAt: now,
			deletedAt: null
		});
		await data.orgs.addOrgMember(S, {
			orgId,
			userId: colleague,
			role: 'owner',
			permissions: [],
			joinedAt: now,
			updatedAt: now,
			updatedBy: colleague,
			deletedAt: null
		});

		const projectId = makeUuid();
		await data.projects.createProject(S, {
			id: projectId,
			orgId,
			name: 'Erasure Project',
			slug: randomSlug('erasure'),
			visibility: 'org',
			ownerId: leaver,
			createdBy: leaver,
			updatedBy: leaver,
			autoJoinOnUpload: false,
			createdAt: now,
			updatedAt: now,
			deletedAt: null
		});
		await data.projects.addProjectMember(S, {
			projectId,
			userId: colleague,
			role: 'editor',
			joinedAt: now,
			updatedAt: now,
			updatedBy: colleague,
			deletedAt: null
		});

		const email = `Leaver-${makeUuid()}@Example.Test`;
		const inviteToThem = invite(orgId, colleague, email);
		const inviteFromThem = invite(orgId, leaver, `newcomer-${makeUuid()}@example.test`);
		const inviteToBystander = invite(orgId, colleague, `bystander-${makeUuid()}@example.test`);
		for (const inv of [inviteToThem, inviteFromThem, inviteToBystander]) {
			await data.invites.create(S, inv);
		}

		const tokenHash = `hash-${makeUuid()}`;
		await apiTokens.create(S, {
			id: makeUuid(),
			userId: leaver,
			createdBy: leaver,
			orgId,
			name: 'leaver laptop',
			tokenHash,
			scopes: ['read:all'],
			createdAt: now,
			expiresAt: new Date(Date.now() + 30 * DAY).toISOString(),
			lastUsedAt: null,
			revokedAt: null
		});

		return {
			data,
			apiTokens,
			leaver,
			colleague,
			email,
			orgId,
			projectId,
			inviteToThem,
			inviteFromThem,
			inviteToBystander,
			tokenHash
		};
	}

	async function erase(world: World, email: string | undefined = world.email): Promise<void> {
		if (deleteIdentity) await deleteIdentity(world.leaver);
		await world.data.onUserDeleted(S, world.leaver, email === undefined ? undefined : { email });
	}

	describe(`IDataProvider.onUserDeleted conformance: ${name}`, () => {
		it('deletes invites addressed to them, matching the address in any case', async () => {
			const world = await buildWorld();
			await erase(world);

			const { invites } = world.data;
			expect(await invites.getByTokenHash(S, world.inviteToThem.tokenHash)).toBeNull();
			expect(await invites.getByTokenHash(S, world.inviteToBystander.tokenHash)).not.toBeNull();
		});

		it('deletes invites they sent', async () => {
			const world = await buildWorld();
			await erase(world);
			expect(await world.data.invites.getByTokenHash(S, world.inviteFromThem.tokenHash)).toBeNull();
		});

		it('ends their API tokens', async () => {
			const world = await buildWorld();
			await erase(world);
			expect(await world.apiTokens.getByTokenHash(S, world.tokenHash)).toBeNull();
		});

		it('ends their org and project memberships, and nobody else’s', async () => {
			const world = await buildWorld();
			await erase(world);

			const { orgs, projects } = world.data;
			expect(await orgs.getOrgMember(S, world.orgId, world.leaver)).toBeNull();
			expect(await projects.getProjectMember(S, world.projectId, world.leaver)).toBeNull();
			expect(await orgs.getOrgMember(S, world.orgId, world.colleague)).not.toBeNull();
			expect(await projects.getProjectMember(S, world.projectId, world.colleague)).not.toBeNull();
		});

		it('removes their profile', async () => {
			const world = await buildWorld();
			await erase(world);
			expect(await world.data.userProfile.getProfile(S, world.leaver)).toBeNull();
		});

		it('keeps the org and project they owned, under the erased actor', async () => {
			const world = await buildWorld();
			await erase(world);

			expect((await world.data.orgs.getOrg(S, world.orgId))?.ownerId).toBe(ERASED_ACTOR_ID);
			expect((await world.data.projects.getProject(S, world.projectId))?.ownerId).toBe(
				ERASED_ACTOR_ID
			);
		});

		it('runs without an email, and still ends their tokens and memberships', async () => {
			const world = await buildWorld();
			await erase(world, undefined);

			expect(await world.apiTokens.getByTokenHash(S, world.tokenHash)).toBeNull();
			expect(await world.data.orgs.getOrgMember(S, world.orgId, world.leaver)).toBeNull();
		});

		it('can run again on a user it already erased', async () => {
			const world = await buildWorld();
			await erase(world);
			await expect(
				world.data.onUserDeleted(S, world.leaver, { email: world.email })
			).resolves.toBeUndefined();
		});
	});
}
