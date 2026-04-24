/**
 * Adapter conformance suite for IProjectStore.
 *
 * Tests project CRUD, project membership management, and access checks to
 * ensure all adapters behave identically.
 */

import { describe, it, expect } from 'vitest';
import type { IProjectStore } from '../../data/interface.js';
import type { Project, ProjectMember } from '../../index.js';
import { makeCtx, makeUuid, noopSeedUser, type SeedUserFn } from './helpers.js';

export interface ProjectStoreConformanceOptions {
	/** Name to show in test output (e.g. "local-provider"). */
	name: string;
	/**
	 * Factory that returns a fresh store, the orgId to use for projects, and
	 * the userId that owns the org (used to scope project ownership).
	 * In single-org mode, return the pre-existing org's id.
	 */
	createStore: () => Promise<{ store: IProjectStore; orgId: string; ownerId: string }>;
	/**
	 * Hook adapters with user FK constraints use to seed `auth.users` before
	 * a conformance test references a user id. Returns the id the adapter
	 * actually stored — callers use that, not the suggested one.
	 */
	seedUser?: SeedUserFn;
	/** If true, run ctx-isolation tests (adapters with row-level security). */
	ctxIsolation?: boolean;
}

const ctx = makeCtx;

function project(orgId: string, ownerId: string, overrides: Partial<Project> = {}): Project {
	const now = new Date().toISOString();
	return {
		id: overrides.id ?? makeUuid(),
		orgId,
		name: overrides.name ?? 'Test Project',
		slug: overrides.slug ?? `test-${Math.random().toString(36).slice(2, 8)}`,
		visibility: overrides.visibility ?? 'private',
		ownerId: overrides.ownerId ?? ownerId,
		createdBy: overrides.createdBy ?? ownerId,
		updatedBy: overrides.updatedBy ?? ownerId,
		autoJoinOnUpload: overrides.autoJoinOnUpload ?? false,
		allowAnonymous: overrides.allowAnonymous ?? false,
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
	const { name, createStore, seedUser = noopSeedUser, ctxIsolation = false } = opts;
	const seed = () => seedUser(makeUuid());

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
			await expect(
				store.createProject(ctx(ownerId), project(orgId, ownerId, { name: 'shared' }))
			).rejects.toThrow();
		});

		it('updateProject rejects renaming to a name already used in the same org', async () => {
			const { store, orgId, ownerId } = await createStore();
			const a = project(orgId, ownerId, { name: 'Alpha' });
			const b = project(orgId, ownerId, { name: 'Beta' });
			await store.createProject(ctx(ownerId), a);
			await store.createProject(ctx(ownerId), b);
			await expect(
				store.updateProject(ctx(ownerId), b.id, { name: 'ALPHA' })
			).rejects.toThrow();
		});

		it('deleteProject removes the project', async () => {
			const { store, orgId, ownerId } = await createStore();
			const p = project(orgId, ownerId);
			await store.createProject(ctx(ownerId), p);
			await store.deleteProject(ctx(ownerId), p.id);
			const got = await store.getProject(ctx(ownerId), p.id);
			expect(got).toBeNull();
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

		it('removeProjectMember deletes the member', async () => {
			const { store, orgId, ownerId } = await createStore();
			const p = project(orgId, ownerId);
			await store.createProject(ctx(ownerId), p);
			const u2 = await seed();
			await store.addProjectMember(ctx(ownerId), member(p.id, u2, 'editor'));
			await store.removeProjectMember(ctx(ownerId), p.id, u2);
			const got = await store.getProjectMember(ctx(ownerId), p.id, u2);
			expect(got).toBeNull();
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
		// B3: audit fields + soft delete
		// ============================================================================

		it('createProject populates createdBy and updatedBy', async () => {
			const { store, orgId, ownerId } = await createStore();
			const p = project(orgId, ownerId);
			await store.createProject(ctx(ownerId), p);
			const got = await store.getProject(ctx(ownerId), p.id);
			expect(got?.createdBy).toBe(ownerId);
			expect(got?.updatedBy).toBe(ownerId);
			expect(got?.deletedAt ?? null).toBeNull();
		});

		it('updateProject advances updatedBy to the caller, preserves createdBy', async () => {
			const { store, orgId, ownerId } = await createStore();
			const p = project(orgId, ownerId);
			await store.createProject(ctx(ownerId), p);
			const editor = await seed();
			// Give the editor membership so the adapter's auth check (if any) permits
			// the update. Conformance runs with permissive ctx defaults in practice.
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
		// B4: project flags (autoJoinOnUpload, allowAnonymous)
		// ============================================================================

		it('create + get round-trips autoJoinOnUpload and allowAnonymous', async () => {
			const { store, orgId, ownerId } = await createStore();
			const p = project(orgId, ownerId, {
				visibility: 'public',
				autoJoinOnUpload: true,
				allowAnonymous: true
			});
			await store.createProject(ctx(ownerId), p);
			const got = await store.getProject(ctx(ownerId), p.id);
			expect(got?.autoJoinOnUpload).toBe(true);
			expect(got?.allowAnonymous).toBe(true);
		});

		it('flags default to false on a project created without them set', async () => {
			const { store, orgId, ownerId } = await createStore();
			const p = project(orgId, ownerId);
			await store.createProject(ctx(ownerId), p);
			const got = await store.getProject(ctx(ownerId), p.id);
			expect(got?.autoJoinOnUpload).toBe(false);
			expect(got?.allowAnonymous).toBe(false);
		});

		if (ctxIsolation) {
			it('ctx isolation: projects created by one user are not visible to another', async () => {
				const { store, orgId } = await createStore();
				const userA = await seed();
				const userB = await seed();
				const pA = project(orgId, userA);
				await store.createProject(ctx(userA), pA);

				const page = await store.listProjects(ctx(userB), orgId);
				expect(page.items.map((p) => p.id)).not.toContain(pA.id);
			});

			it('ctx isolation: user cannot get a project they do not own', async () => {
				const { store, orgId } = await createStore();
				const userA = await seed();
				const userB = await seed();
				const pA = project(orgId, userA);
				await store.createProject(ctx(userA), pA);

				const got = await store.getProject(ctx(userB), pA.id);
				expect(got).toBeNull();
			});
		}
	});
}
