// Conformance suite for IProjectStore: CRUD, membership, reactivation and (opt-in) ctx scoping.

import { describe, it, expect } from 'vitest';
import type { IProjectStore } from '../../projects/interface.js';
import type { Project, ProjectMember } from '../../index.js';
import {
	makeExpectDenied,
	makeSeedHelpers,
	makeUuid,
	noopSeedUser,
	randomSlug,
	type SeedUserFn
} from './helpers.js';

export interface ProjectStoreConformanceOptions {
	/** Name to show in test output (e.g. "local-provider"). */
	name: string;
	/**
	 * Factory that returns a fresh store, the orgId to use for projects, and
	 * the userId that owns the org (used to scope project ownership).
	 * In single-org mode, return the pre-existing org's id.
	 *
	 * `ownerSessionToken` is optional — adapters that enforce auth at the DB
	 * layer (Supabase RLS) must include it so `ctx(ownerId)` runs the call as
	 * that authenticated user. Local providers can omit it.
	 */
	createStore: () => Promise<{
		store: IProjectStore;
		orgId: string;
		/** A second org the owner can create projects in, for the `orgScoping` cases. */
		otherOrgId?: string;
		ownerId: string;
		ownerSessionToken?: string;
	}>;
	/**
	 * Hook adapters with user FK constraints use to seed `auth.users` before
	 * a conformance test references a user id. Returns the id the adapter
	 * actually stored — callers use that, not the suggested one.
	 */
	seedUser?: SeedUserFn;
	/**
	 * Seeds the other party in the ctx-isolation cases. Needed where `seedUser` makes
	 * instance admins, who see everything by design.
	 */
	seedOutsider?: SeedUserFn;
	/**
	 * The adapter scopes reads by `ctx` in the store (Supabase RLS), so a user outside
	 * the project sees nothing. An adapter that leaves scoping to the server guards
	 * (local) skips these cases.
	 */
	ctxIsolation?: boolean;
	/** Denials assert the `ProviderError` status (409 for a taken name), not just a rejection. */
	strictDenials?: boolean;
	/** The default `ctx` holds no platform permissions, so no case passes on an `instance_admin` bypass. */
	nonAdminCtx?: boolean;
	/** `createProject` keeps the `createdBy` of a creator who isn't the owner. */
	auditStamps?: boolean;
	/**
	 * `getProjectBySlug` and `listProjects` stay inside the org asked for, when another
	 * org uses the same slug. Needs `otherOrgId` from `createStore`.
	 */
	orgScoping?: boolean;
}

function project(orgId: string, ownerId: string, overrides: Partial<Project> = {}): Project {
	const now = new Date().toISOString();
	return {
		id: overrides.id ?? makeUuid(),
		orgId,
		name: overrides.name ?? 'Test Project',
		slug: overrides.slug ?? randomSlug(),
		visibility: overrides.visibility ?? 'private',
		ownerId: overrides.ownerId ?? ownerId,
		createdBy: overrides.createdBy ?? ownerId,
		updatedBy: overrides.updatedBy ?? ownerId,
		autoJoinOnUpload: overrides.autoJoinOnUpload ?? false,
		createdAt: overrides.createdAt ?? now,
		updatedAt: overrides.updatedAt ?? now,
		deletedAt: overrides.deletedAt ?? null,
		...overrides
	};
}

function member(projectId: string, userId: string, role: ProjectMember['role']): ProjectMember {
	const now = new Date().toISOString();
	return {
		projectId,
		userId,
		role,
		joinedAt: now,
		updatedAt: now,
		updatedBy: userId,
		deletedAt: null
	};
}

export function runProjectStoreConformance(opts: ProjectStoreConformanceOptions): void {
	const {
		name,
		createStore: rawCreateStore,
		seedUser = noopSeedUser,
		seedOutsider = seedUser,
		ctxIsolation = false,
		strictDenials = false,
		nonAdminCtx = false,
		auditStamps = false,
		orgScoping = false
	} = opts;
	const { seed, ctx, remember } = makeSeedHelpers(seedUser, { nonAdminCtx });
	const outsider = makeSeedHelpers(seedOutsider);
	const outsiderPerms = { platformPermissions: [], orgPermissions: [] };
	const expectDenied = makeExpectDenied(strictDenials);
	const createStore = async () => {
		const result = await rawCreateStore();
		remember({ userId: result.ownerId, sessionToken: result.ownerSessionToken });
		return result;
	};

	describe(`IProjectStore conformance: ${name}`, () => {
		// ============================================================================
		// Projects
		// ============================================================================

		it('createProject + getProject returns the project', async () => {
			const { store, orgId, ownerId } = await createStore();
			const p = project(orgId, ownerId);
			await store.createProject(ctx(ownerId), p);
			const got = await store.getProject(ctx(ownerId), p.id);
			expect(got?.name).toBe('Test Project');
		});

		it('getProject returns null for missing id', async () => {
			const { store, ownerId } = await createStore();
			const got = await store.getProject(ctx(ownerId), makeUuid());
			expect(got).toBeNull();
		});

		it('getProjectBySlug finds project by slug', async () => {
			const { store, orgId, ownerId } = await createStore();
			const p = project(orgId, ownerId, { slug: 'my-proj' });
			await store.createProject(ctx(ownerId), p);
			const got = await store.getProjectBySlug(ctx(ownerId), orgId, 'my-proj');
			expect(got?.id).toBe(p.id);
		});

		it('getProjectBySlug returns null for missing slug', async () => {
			const { store, orgId, ownerId } = await createStore();
			const got = await store.getProjectBySlug(ctx(ownerId), orgId, 'nonexistent');
			expect(got).toBeNull();
		});

		it('updateProject modifies name, slug, description, visibility', async () => {
			const { store, orgId, ownerId } = await createStore();
			const p = project(orgId, ownerId, { slug: 'old', visibility: 'private' });
			await store.createProject(ctx(ownerId), p);
			await store.updateProject(ctx(ownerId), p.id, {
				name: 'New Name',
				slug: 'new-slug',
				description: 'New desc',
				visibility: 'org'
			});
			const got = await store.getProject(ctx(ownerId), p.id);
			expect(got?.name).toBe('New Name');
			expect(got?.slug).toBe('new-slug');
			expect(got?.description).toBe('New desc');
			expect(got?.visibility).toBe('org');
		});

		it('createProject rejects duplicate name in the same org (case-insensitive)', async () => {
			const { store, orgId, ownerId } = await createStore();
			await store.createProject(ctx(ownerId), project(orgId, ownerId, { name: 'Shared' }));
			await expectDenied(
				store.createProject(ctx(ownerId), project(orgId, ownerId, { name: 'shared' })),
				409
			);
		});

		it('updateProject rejects renaming to a name already used in the same org', async () => {
			const { store, orgId, ownerId } = await createStore();
			const a = project(orgId, ownerId, { name: 'Alpha' });
			const b = project(orgId, ownerId, { name: 'Beta' });
			await store.createProject(ctx(ownerId), a);
			await store.createProject(ctx(ownerId), b);
			await expectDenied(store.updateProject(ctx(ownerId), b.id, { name: 'ALPHA' }), 409);
		});

		it('listProjects returns all projects with pagination', async () => {
			const { store, orgId, ownerId } = await createStore();
			for (let i = 0; i < 3; i++) {
				await store.createProject(
					ctx(ownerId),
					project(orgId, ownerId, { name: `Paginated ${i}` })
				);
			}
			const page = await store.listProjects(ctx(ownerId), orgId, { limit: 2 });
			expect(page.items.length).toBe(2);
		});

		if (orgScoping) {
			const otherOrgOf = (store: { otherOrgId?: string }): string => {
				if (!store.otherOrgId)
					throw new Error('orgScoping requires createStore to return otherOrgId');
				return store.otherOrgId;
			};

			it('getProjectBySlug answers from the org asked, when another org uses the same slug', async () => {
				const created = await createStore();
				const { store, orgId, ownerId } = created;
				const otherOrgId = otherOrgOf(created);
				const mine = project(orgId, ownerId, { slug: 'shared-slug' });
				const theirs = project(otherOrgId, ownerId, { slug: 'shared-slug' });
				await store.createProject(ctx(ownerId), mine);
				await store.createProject(ctx(ownerId), theirs);

				expect((await store.getProjectBySlug(ctx(ownerId), orgId, 'shared-slug'))?.id).toBe(
					mine.id
				);
				expect((await store.getProjectBySlug(ctx(ownerId), otherOrgId, 'shared-slug'))?.id).toBe(
					theirs.id
				);
			});

			it('getProjectBySlug returns null for a slug only another org uses', async () => {
				const created = await createStore();
				const { store, orgId, ownerId } = created;
				const elsewhere = project(otherOrgOf(created), ownerId, { slug: 'elsewhere' });
				await store.createProject(ctx(ownerId), elsewhere);
				expect(await store.getProjectBySlug(ctx(ownerId), orgId, 'elsewhere')).toBeNull();
			});

			it('listProjects leaves out another org’s projects', async () => {
				const created = await createStore();
				const { store, orgId, ownerId } = created;
				const a = project(orgId, ownerId, { name: 'Mine A' });
				const b = project(orgId, ownerId, { name: 'Mine B' });
				const theirs = project(otherOrgOf(created), ownerId, { name: 'Theirs' });
				for (const p of [a, b, theirs]) await store.createProject(ctx(ownerId), p);

				const page = await store.listProjects(ctx(ownerId), orgId, { limit: 100 });
				expect(page.items.map((p) => p.id).sort()).toEqual([a.id, b.id].sort());
			});
		}

		// ============================================================================
		// Project Members
		// ============================================================================

		it('addProjectMember + getProjectMember returns the member', async () => {
			const { store, orgId, ownerId } = await createStore();
			const p = project(orgId, ownerId);
			await store.createProject(ctx(ownerId), p);
			const u2 = await seed();
			await store.addProjectMember(ctx(ownerId), member(p.id, u2, 'editor'));
			const got = await store.getProjectMember(ctx(ownerId), p.id, u2);
			expect(got?.role).toBe('editor');
		});

		it('getProjectMember returns null for missing member', async () => {
			const { store, orgId, ownerId } = await createStore();
			const p = project(orgId, ownerId);
			await store.createProject(ctx(ownerId), p);
			const got = await store.getProjectMember(ctx(ownerId), p.id, makeUuid());
			expect(got).toBeNull();
		});

		it('getProjectMembersFor resolves many projects for one user in one call', async () => {
			const { store, orgId, ownerId } = await createStore();
			const p1 = project(orgId, ownerId, { name: 'Bulk Members A' });
			const p2 = project(orgId, ownerId, { name: 'Bulk Members B' });
			await store.createProject(ctx(ownerId), p1);
			await store.createProject(ctx(ownerId), p2);
			const u2 = await seed();
			await store.addProjectMember(ctx(ownerId), member(p1.id, u2, 'editor'));

			const got = await store.getProjectMembersFor(ctx(ownerId), [p1.id, p2.id], u2);
			expect(got.get(p1.id)?.role).toBe('editor');
			// Present as an explicit null, not absent — callers distinguish
			// "checked, not a member" from "never asked".
			expect(got.has(p2.id)).toBe(true);
			expect(got.get(p2.id)).toBeNull();
		});

		it('getProjectMembersFor omits soft-deleted memberships', async () => {
			const { store, orgId, ownerId } = await createStore();
			const p = project(orgId, ownerId);
			await store.createProject(ctx(ownerId), p);
			const u2 = await seed();
			await store.addProjectMember(ctx(ownerId), member(p.id, u2, 'editor'));
			await store.removeProjectMember(ctx(ownerId), p.id, u2);

			const got = await store.getProjectMembersFor(ctx(ownerId), [p.id], u2);
			expect(got.get(p.id)).toBeNull();
		});

		it('getProjectMembersFor returns an empty map for no ids', async () => {
			const { store, ownerId } = await createStore();
			expect((await store.getProjectMembersFor(ctx(ownerId), [], ownerId)).size).toBe(0);
		});

		it('updateProjectMemberRole changes role', async () => {
			const { store, orgId, ownerId } = await createStore();
			const p = project(orgId, ownerId);
			await store.createProject(ctx(ownerId), p);
			const u2 = await seed();
			await store.addProjectMember(ctx(ownerId), member(p.id, u2, 'viewer'));
			await store.updateProjectMemberRole(ctx(ownerId), p.id, u2, 'editor');
			const got = await store.getProjectMember(ctx(ownerId), p.id, u2);
			expect(got?.role).toBe('editor');
		});

		it('listProjectMembers returns members with pagination', async () => {
			const { store, orgId, ownerId } = await createStore();
			const p = project(orgId, ownerId);
			await store.createProject(ctx(ownerId), p);
			for (let i = 0; i < 3; i++) {
				const u = await seed();
				await store.addProjectMember(ctx(ownerId), member(p.id, u, 'viewer'));
			}
			const page = await store.listProjectMembers(ctx(ownerId), p.id, { limit: 2 });
			expect(page.items.length).toBe(2);
		});

		// ============================================================================
		// Audit fields + soft delete
		// ============================================================================

		it('createProject stores createdBy and updatedBy, and no deletedAt', async () => {
			const { store, orgId, ownerId } = await createStore();
			// Under auditStamps someone other than the owner creates it, so a store that
			// copies ownerId into createdBy fails.
			const creator = auditStamps ? await seed() : ownerId;
			const p = project(orgId, ownerId, { createdBy: creator, updatedBy: creator });
			await store.createProject(ctx(creator), p);
			const got = await store.getProject(ctx(ownerId), p.id);
			expect(got?.createdBy).toBe(creator);
			expect(got?.updatedBy).toBe(creator);
			expect(got?.deletedAt ?? null).toBeNull();
		});

		it('updateProject advances updatedBy to the caller, preserves createdBy', async () => {
			const { store, orgId, ownerId } = await createStore();
			const p = project(orgId, ownerId);
			await store.createProject(ctx(ownerId), p);
			const editor = await seed();
			// Membership, so an adapter that checks the editor's rights lets the update through.
			await store.addProjectMember(ctx(ownerId), member(p.id, editor, 'editor'));
			await store.updateProject(ctx(editor), p.id, { name: 'Renamed' });
			const got = await store.getProject(ctx(ownerId), p.id);
			expect(got?.updatedBy).toBe(editor);
			expect(got?.createdBy).toBe(ownerId);
		});

		it('deleteProject soft-deletes — the project stops appearing in reads', async () => {
			const { store, orgId, ownerId } = await createStore();
			const p = project(orgId, ownerId);
			await store.createProject(ctx(ownerId), p);
			await store.deleteProject(ctx(ownerId), p.id);
			expect(await store.getProject(ctx(ownerId), p.id)).toBeNull();
			expect(await store.getProjectBySlug(ctx(ownerId), orgId, p.slug)).toBeNull();
			const listed = await store.listProjects(ctx(ownerId), orgId, { limit: 100 });
			expect(listed.items.map((x) => x.id)).not.toContain(p.id);
		});

		it('deleteProject cascades soft-delete to project members', async () => {
			const { store, orgId, ownerId } = await createStore();
			const p = project(orgId, ownerId);
			await store.createProject(ctx(ownerId), p);
			const u2 = await seed();
			await store.addProjectMember(ctx(ownerId), member(p.id, u2, 'editor'));
			await store.deleteProject(ctx(ownerId), p.id);
			const got = await store.getProjectMember(ctx(ownerId), p.id, u2);
			expect(got).toBeNull();
			const listed = await store.listProjectMembers(ctx(ownerId), p.id, { limit: 100 });
			expect(listed.items).toHaveLength(0);
		});

		it('removeProjectMember soft-deletes — the member stops appearing in reads', async () => {
			const { store, orgId, ownerId } = await createStore();
			const p = project(orgId, ownerId);
			await store.createProject(ctx(ownerId), p);
			const u2 = await seed();
			await store.addProjectMember(ctx(ownerId), member(p.id, u2, 'editor'));
			await store.removeProjectMember(ctx(ownerId), p.id, u2);
			expect(await store.getProjectMember(ctx(ownerId), p.id, u2)).toBeNull();
		});

		// ============================================================================
		// reactivateProject — un-delete (slug-tombstone problem)
		// ============================================================================

		it('reactivateProject returns null when no tombstone exists for that slug', async () => {
			const { store, orgId, ownerId } = await createStore();
			const got = await store.reactivateProject(ctx(ownerId), orgId, 'no-such-slug');
			expect(got).toBeNull();
		});

		it('reactivateProject clears the tombstone and surfaces it via getProject/getProjectBySlug', async () => {
			const { store, orgId, ownerId } = await createStore();
			const p = project(orgId, ownerId, { slug: 'revive-me' });
			await store.createProject(ctx(ownerId), p);
			await store.deleteProject(ctx(ownerId), p.id);
			// Before reactivation: invisible
			expect(await store.getProject(ctx(ownerId), p.id)).toBeNull();
			expect(await store.getProjectBySlug(ctx(ownerId), orgId, 'revive-me')).toBeNull();

			const revived = await store.reactivateProject(ctx(ownerId), orgId, 'revive-me');
			expect(revived?.id).toBe(p.id);
			expect(revived?.slug).toBe('revive-me');
			// After reactivation: visible again
			expect(await store.getProject(ctx(ownerId), p.id)).not.toBeNull();
			expect(await store.getProjectBySlug(ctx(ownerId), orgId, 'revive-me')).not.toBeNull();
		});

		it('reactivateProject restores the owner project_member row', async () => {
			const { store, orgId, ownerId } = await createStore();
			const p = project(orgId, ownerId, { slug: 'member-revive' });
			await store.createProject(ctx(ownerId), p);
			await store.deleteProject(ctx(ownerId), p.id);
			await store.reactivateProject(ctx(ownerId), orgId, 'member-revive');
			const m = await store.getProjectMember(ctx(ownerId), p.id, ownerId);
			expect(m?.role).toBe('owner');
		});

		it('reactivateProject survives a second delete and reactivate cycle', async () => {
			const { store, orgId, ownerId } = await createStore();
			const p = project(orgId, ownerId, { slug: 'reseed-slug' });
			await store.createProject(ctx(ownerId), p);
			await store.deleteProject(ctx(ownerId), p.id);
			await store.reactivateProject(ctx(ownerId), orgId, 'reseed-slug');
			await store.deleteProject(ctx(ownerId), p.id);
			await store.reactivateProject(ctx(ownerId), orgId, 'reseed-slug');
			expect(await store.getProjectBySlug(ctx(ownerId), orgId, 'reseed-slug')).not.toBeNull();
		});

		// ============================================================================
		// Project flags (autoJoinOnUpload)
		// ============================================================================

		it('create + get round-trips autoJoinOnUpload, true and false', async () => {
			const { store, orgId, ownerId } = await createStore();
			const on = project(orgId, ownerId, { visibility: 'public', autoJoinOnUpload: true });
			const off = project(orgId, ownerId, { name: 'Flag Off', autoJoinOnUpload: false });
			await store.createProject(ctx(ownerId), on);
			await store.createProject(ctx(ownerId), off);
			expect((await store.getProject(ctx(ownerId), on.id))?.autoJoinOnUpload).toBe(true);
			expect((await store.getProject(ctx(ownerId), off.id))?.autoJoinOnUpload).toBe(false);
		});

		if (ctxIsolation) {
			it('ctx isolation: projects created by one user are not visible to another', async () => {
				const { store, orgId } = await createStore();
				const userA = await seed();
				const userB = await outsider.seed();
				const pA = project(orgId, userA);
				await store.createProject(ctx(userA), pA);

				const page = await store.listProjects(outsider.ctx(userB, outsiderPerms), orgId);
				expect(page.items.map((p) => p.id)).not.toContain(pA.id);
			});

			it('ctx isolation: user cannot get a project they do not own', async () => {
				const { store, orgId } = await createStore();
				const userA = await seed();
				const userB = await outsider.seed();
				const pA = project(orgId, userA);
				await store.createProject(ctx(userA), pA);

				const got = await store.getProject(outsider.ctx(userB, outsiderPerms), pA.id);
				expect(got).toBeNull();
			});
		}
	});
}
