/**
 * Adapter conformance suite for IOrgStore.
 *
 * Tests organization CRUD and org membership management to ensure all
 * adapters behave identically.
 */

import { describe, it, expect } from 'vitest';
import type { IOrgStore } from '../../organizations/interface.js';
import type { IComputeServerStore } from '../../computeServer/interface.js';
import type { IInviteStore } from '../../invites/interface.js';
import type { Organization, OrgMember, OrgRole, Invite, ComputeServerConfig } from '../../index.js';
import { DEFAULT_ORG_PERMISSIONS } from '../../organizations/schemas.js';
import { SYSTEM_CONTEXT } from '../../context.js';
import { makeSeedHelpers, makeUuid, noopSeedUser, type SeedUserFn } from './helpers.js';

export interface OrgStoreConformanceOptions {
	/** Name to show in test output (e.g. "local-provider"). */
	name: string;
	/** Factory that returns a fresh, empty store per test. */
	createStore: () => Promise<IOrgStore> | IOrgStore;
	/**
	 * Hook adapters with user FK constraints use to seed `auth.users` before
	 * a conformance test references a user id. Returns the id the adapter
	 * actually stored — callers use that, not the suggested one.
	 */
	seedUser?: SeedUserFn;
	/** If true, skip createOrg/deleteOrg tests (e.g. single-org providers). */
	singleOrgMode?: boolean;
	/** If true, run ctx-isolation tests (adapters with row-level security). */
	ctxIsolation?: boolean;
	/**
	 * When supplied, an extra `deleteOrg` cascade test runs that asserts
	 * pending invites and the org's compute override are cleaned up too.
	 * The factories must return stores wired to the same underlying state
	 * as `createStore` (i.e. the same data provider instance for local,
	 * the same Supabase project for the remote adapter).
	 */
	createCompanionStores?: () =>
		| Promise<{ invites: IInviteStore; computeServer: IComputeServerStore }>
		| { invites: IInviteStore; computeServer: IComputeServerStore };
}

function org(ownerId: string, overrides: Partial<Organization> = {}): Organization {
	const now = new Date().toISOString();
	return {
		id: overrides.id ?? makeUuid(),
		name: overrides.name ?? 'Test Org',
		slug: overrides.slug ?? `test-${Math.random().toString(36).slice(2, 8)}`,
		ownerId: overrides.ownerId ?? ownerId,
		createdBy: overrides.createdBy ?? ownerId,
		updatedBy: overrides.updatedBy ?? ownerId,
		createdAt: overrides.createdAt ?? now,
		updatedAt: overrides.updatedAt ?? now,
		deletedAt: overrides.deletedAt ?? null,
		...overrides
	};
}

function member(orgId: string, userId: string, role: OrgRole = 'member'): OrgMember {
	const now = new Date().toISOString();
	return {
		orgId,
		userId,
		role,
		permissions: [...DEFAULT_ORG_PERMISSIONS[role]],
		joinedAt: now,
		updatedAt: now,
		updatedBy: userId,
		deletedAt: null
	};
}

export function runOrgStoreConformance(opts: OrgStoreConformanceOptions): void {
	const {
		name,
		createStore,
		seedUser = noopSeedUser,
		singleOrgMode = false,
		ctxIsolation = false,
		createCompanionStores
	} = opts;
	const { seed, ctx } = makeSeedHelpers(seedUser);

	describe(`IOrgStore conformance: ${name}`, () => {
		// ============================================================================
		// Organizations
		// ============================================================================

		if (!singleOrgMode) {
			it('createOrg + getOrg returns the organization', async () => {
				const store = await createStore();
				const u1 = await seed();
				const orgId = makeUuid();
				await store.createOrg(ctx(u1), org(u1, { id: orgId, slug: 'acme' }));
				const got = await store.getOrg(ctx(u1), orgId);
				expect(got?.name).toBe('Test Org');
				expect(got?.slug).toBe('acme');
			});

			it('getOrg returns null for missing id', async () => {
				const store = await createStore();
				const u1 = await seed();
				const got = await store.getOrg(ctx(u1), makeUuid());
				expect(got).toBeNull();
			});

			it('getOrgBySlug finds org by slug', async () => {
				const store = await createStore();
				const u1 = await seed();
				const orgId = makeUuid();
				await store.createOrg(ctx(u1), org(u1, { id: orgId, slug: 'acme-corp' }));
				const got = await store.getOrgBySlug(ctx(u1), 'acme-corp');
				expect(got?.id).toBe(orgId);
			});

			it('getOrgBySlug returns null for missing slug', async () => {
				const store = await createStore();
				const u1 = await seed();
				const got = await store.getOrgBySlug(ctx(u1), 'nonexistent');
				expect(got).toBeNull();
			});

			it('updateOrg modifies name and slug', async () => {
				const store = await createStore();
				const u1 = await seed();
				const orgId = makeUuid();
				await store.createOrg(ctx(u1), org(u1, { id: orgId, slug: 'old-slug' }));
				await store.updateOrg(ctx(u1), orgId, { name: 'New Name', slug: 'new-slug' });
				const got = await store.getOrg(ctx(u1), orgId);
				expect(got?.name).toBe('New Name');
				expect(got?.slug).toBe('new-slug');
			});

			it('updateOrg sets and clears branding assets', async () => {
				const store = await createStore();
				const u1 = await seed();
				const orgId = makeUuid();
				await store.createOrg(ctx(u1), org(u1, { id: orgId, slug: 'asset-org' }));

				// Set the logo asset.
				await store.updateOrg(ctx(u1), orgId, { assets: { logo: '/api/files/orgs/x/logo.webp' } });
				expect((await store.getOrg(ctx(u1), orgId))?.assets?.logo).toBe(
					'/api/files/orgs/x/logo.webp'
				);

				// Replace the whole map (drops logo) — the store persists what it's given.
				await store.updateOrg(ctx(u1), orgId, { assets: {} });
				expect((await store.getOrg(ctx(u1), orgId))?.assets?.logo ?? null).toBeNull();
			});

			it('deleteOrg removes the organization', async () => {
				const store = await createStore();
				const u1 = await seed();
				const orgId = makeUuid();
				await store.createOrg(ctx(u1), org(u1, { id: orgId }));
				await store.deleteOrg(ctx(u1), orgId);
				const got = await store.getOrg(ctx(u1), orgId);
				expect(got).toBeNull();
			});

			it('listOrgs returns all organizations with pagination', async () => {
				const store = await createStore();
				const u1 = await seed();
				for (let i = 0; i < 3; i++) {
					await store.createOrg(ctx(u1), org(u1));
				}
				const page = await store.listOrgs(ctx(u1), { limit: 2 });
				expect(page.items.length).toBe(2);
				expect(page.nextCursor).toBeTruthy();
			});
		} else {
			it('getOrg returns the default organization', async () => {
				const store = await createStore();
				const u1 = await seed();
				const orgs = await store.listOrgs(ctx(u1));
				expect(orgs.items.length > 0).toBe(true);
			});
		}

		// ============================================================================
		// Org Members
		// ============================================================================

		async function setupOrg(store: IOrgStore): Promise<{ u1: string; orgId: string }> {
			const u1 = await seed();
			const orgs = await store.listOrgs(ctx(u1));
			let orgId: string;
			if (singleOrgMode) {
				orgId = orgs.items[0].id;
			} else {
				orgId = makeUuid();
				await store.createOrg(ctx(u1), org(u1, { id: orgId }));
			}
			return { u1, orgId };
		}

		it('addOrgMember + getOrgMember returns the member', async () => {
			const store = await createStore();
			const { u1, orgId } = await setupOrg(store);
			const u2 = await seed();
			await store.addOrgMember(ctx(u1), member(orgId, u2));
			const got = await store.getOrgMember(ctx(u1), orgId, u2);
			expect(got?.role).toBe('member');
		});

		it('getOrgMember returns null for missing member', async () => {
			const store = await createStore();
			const { u1, orgId } = await setupOrg(store);
			const got = await store.getOrgMember(ctx(u1), orgId, makeUuid());
			expect(got).toBeNull();
		});

		it('updateOrgMemberRole changes role', async () => {
			const store = await createStore();
			const { u1, orgId } = await setupOrg(store);
			const u2 = await seed();
			await store.addOrgMember(ctx(u1), member(orgId, u2));
			await store.updateOrgMemberRole(ctx(u1), orgId, u2, 'admin');
			const got = await store.getOrgMember(ctx(u1), orgId, u2);
			expect(got?.role).toBe('admin');
		});

		it('removeOrgMember deletes the member', async () => {
			const store = await createStore();
			const { u1, orgId } = await setupOrg(store);
			const u2 = await seed();
			await store.addOrgMember(ctx(u1), member(orgId, u2));
			await store.removeOrgMember(ctx(u1), orgId, u2);
			const got = await store.getOrgMember(ctx(u1), orgId, u2);
			expect(got).toBeNull();
		});

		it('findUserMembership returns one (org, member) for a member', async () => {
			const store = await createStore();
			const { u1, orgId } = await setupOrg(store);
			const u2 = await seed();
			await store.addOrgMember(ctx(u1), member(orgId, u2));

			// Looked up via SYSTEM_CONTEXT — the bootstrap path is the primary
			// caller and runs before a per-user ctx exists.
			const found = await store.findUserMembership(SYSTEM_CONTEXT, u2);
			expect(found).not.toBeNull();
			expect(found!.org.id).toBe(orgId);
			expect(found!.member.userId).toBe(u2);
			expect(found!.member.role).toBe('member');
		});

		it('findUserMembership returns null for a user with no memberships', async () => {
			const store = await createStore();
			await setupOrg(store); // ensure at least one org exists
			const stranger = await seed();

			const found = await store.findUserMembership(SYSTEM_CONTEXT, stranger);
			expect(found).toBeNull();
		});

		it('findUserMembership skips soft-deleted memberships', async () => {
			const store = await createStore();
			const { u1, orgId } = await setupOrg(store);
			const u2 = await seed();
			await store.addOrgMember(ctx(u1), member(orgId, u2));
			await store.removeOrgMember(ctx(u1), orgId, u2);

			const found = await store.findUserMembership(SYSTEM_CONTEXT, u2);
			expect(found).toBeNull();
		});

		it('findUserMembership skips memberships in soft-deleted orgs', async () => {
			const store = await createStore();
			const { u1, orgId } = await setupOrg(store);
			// u1 is a member of `orgId` — kill the org and verify the lookup
			// returns null (membership in a dead org should not surface).
			await store.deleteOrg(ctx(u1), orgId);

			const found = await store.findUserMembership(SYSTEM_CONTEXT, u1);
			expect(found).toBeNull();
		});

		it('listOrgMembers returns members with pagination', async () => {
			const store = await createStore();
			const { u1, orgId } = await setupOrg(store);
			for (let i = 0; i < 3; i++) {
				const u = await seed();
				await store.addOrgMember(ctx(u1), member(orgId, u));
			}
			const page = await store.listOrgMembers(ctx(u1), orgId, { limit: 2 });
			expect(page.items.length).toBe(2);
		});

		// ============================================================================
		// Audit fields + soft delete
		// ============================================================================

		if (!singleOrgMode) {
			it('createOrg populates createdBy and updatedBy', async () => {
				const store = await createStore();
				const u1 = await seed();
				const orgId = makeUuid();
				await store.createOrg(ctx(u1), org(u1, { id: orgId, slug: `audit-${orgId.slice(0, 8)}` }));
				const got = await store.getOrg(ctx(u1), orgId);
				expect(got?.createdBy).toBe(u1);
				expect(got?.updatedBy).toBe(u1);
				expect(got?.deletedAt ?? null).toBeNull();
			});

			it('updateOrg advances updatedBy to the caller, preserves createdBy', async () => {
				const store = await createStore();
				const u1 = await seed();
				const u2 = await seed();
				const orgId = makeUuid();
				await store.createOrg(ctx(u1), org(u1, { id: orgId, slug: `u-${orgId.slice(0, 8)}` }));
				// Seed u2 as admin so (if auth is enforced) they can mutate the org.
				await store.addOrgMember(ctx(u1), member(orgId, u2, 'admin'));
				await store.updateOrg(ctx(u2), orgId, { name: 'Renamed' });
				const got = await store.getOrg(ctx(u1), orgId);
				expect(got?.updatedBy).toBe(u2);
				expect(got?.createdBy).toBe(u1);
			});

			it('deleteOrg soft-deletes — org stops appearing in reads', async () => {
				const store = await createStore();
				const u1 = await seed();
				const orgId = makeUuid();
				const slug = `sd-${orgId.slice(0, 8)}`;
				await store.createOrg(ctx(u1), org(u1, { id: orgId, slug }));
				await store.deleteOrg(ctx(u1), orgId);
				expect(await store.getOrg(ctx(u1), orgId)).toBeNull();
				expect(await store.getOrgBySlug(ctx(u1), slug)).toBeNull();
			});

			it('deleteOrg cascades soft-delete to org members', async () => {
				const store = await createStore();
				const u1 = await seed();
				const u2 = await seed();
				const orgId = makeUuid();
				await store.createOrg(ctx(u1), org(u1, { id: orgId, slug: `c-${orgId.slice(0, 8)}` }));
				await store.addOrgMember(ctx(u1), member(orgId, u2));
				await store.deleteOrg(ctx(u1), orgId);
				expect(await store.getOrgMember(ctx(u1), orgId, u2)).toBeNull();
			});

			if (createCompanionStores) {
				it('deleteOrg cascades into invites and the org compute override', async () => {
					const store = await createStore();
					const { invites, computeServer } = await createCompanionStores();
					const u1 = await seed();
					const orgId = makeUuid();
					await store.createOrg(ctx(u1), org(u1, { id: orgId, slug: `cc-${orgId.slice(0, 8)}` }));

					// Pending invite + org compute override.
					const invite: Invite = {
						id: makeUuid(),
						tokenHash: `hash-${makeUuid()}`,
						email: 'pending@example.com',
						orgId,
						orgRole: 'member',
						orgPermissions: [],
						invitedBy: u1,
						createdAt: new Date().toISOString(),
						expiresAt: new Date(Date.now() + 86_400_000).toISOString()
					};
					await invites.create(ctx(u1), invite);
					const orgCtx = { ...ctx(u1), actingOrgId: orgId };
					const server: ComputeServerConfig = {
						id: makeUuid(),
						scope: 'org',
						ownerOrgId: orgId,
						label: 'BYO',
						serverUrl: 'https://compute.example.com',
						apiKey: 'secret'
					};
					await computeServer.saveOrgServers(orgCtx, orgId, [server], server.id);

					await store.deleteOrg(ctx(u1), orgId);

					expect(await invites.getByTokenHash(ctx(u1), invite.tokenHash)).toBeNull();
					const remainingConfig = await computeServer.getConfig(orgCtx);
					const orgRows = remainingConfig.servers.filter(
						(s) => s.scope === 'org' && s.ownerOrgId === orgId
					);
					expect(orgRows).toEqual([]);
					expect(remainingConfig.orgDefaults?.[orgId]).toBeUndefined();
				});
			}
		}

		it('removeOrgMember soft-deletes — the member stops appearing in reads', async () => {
			const store = await createStore();
			const { u1, orgId } = await setupOrg(store);
			const u2 = await seed();
			await store.addOrgMember(ctx(u1), member(orgId, u2));
			await store.removeOrgMember(ctx(u1), orgId, u2);
			expect(await store.getOrgMember(ctx(u1), orgId, u2)).toBeNull();
			const page = await store.listOrgMembers(ctx(u1), orgId, { limit: 100 });
			expect(page.items.map((m) => m.userId)).not.toContain(u2);
		});

		if (ctxIsolation) {
			it('ctx isolation: orgs created by one user are not visible to another', async () => {
				const store = await createStore();
				const userA = await seed();
				const userB = await seed();
				const orgA = makeUuid();
				await store.createOrg(
					ctx(userA),
					org(userA, { id: orgA, slug: `org-a-${orgA.slice(0, 8)}` })
				);

				const page = await store.listOrgs(ctx(userB));
				expect(page.items.map((o) => o.id)).not.toContain(orgA);
			});

			it('ctx isolation: user cannot get an org they do not own', async () => {
				const store = await createStore();
				const userA = await seed();
				const userB = await seed();
				const orgA = makeUuid();
				await store.createOrg(
					ctx(userA),
					org(userA, { id: orgA, slug: `org-a-${orgA.slice(0, 8)}` })
				);

				const got = await store.getOrg(ctx(userB), orgA);
				expect(got).toBeNull();
			});
		}
	});
}
