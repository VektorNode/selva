/**
 * Adapter conformance suite for IProjectStore.
 *
 * Tests project CRUD, project membership management, and access checks to
 * ensure all adapters behave identically.
 */

import type { IProjectStore } from '../../data/interface.js';
import type { Project, ProjectMember } from '../../index.js';
import { type ConformanceRunner, makeCtx, makeUuid } from './runner.js';

export interface ProjectStoreConformanceOptions {
	/** Name to show in test output (e.g. "local-provider"). */
	name: string;
	/**
	 * Factory that returns a fresh store and the orgId to use for projects.
	 * In single-org mode, return the pre-existing org's id.
	 */
	createStore: () => Promise<{ store: IProjectStore; orgId: string }>;
	/** Test runner globals. */
	runner: ConformanceRunner;
	/** If true, run ctx-isolation tests (adapters with row-level security). */
	ctxIsolation?: boolean;
}

const ctx = makeCtx;

function project(orgId: string, overrides: Partial<Project> = {}): Project {
	const now = new Date().toISOString();
	return {
		id: overrides.id ?? makeUuid(),
		orgId,
		name: overrides.name ?? 'Test Project',
		slug: overrides.slug ?? `test-${Math.random().toString(36).slice(2, 8)}`,
		visibility: overrides.visibility ?? 'private',
		ownerId: overrides.ownerId ?? 'user-1',
		createdAt: overrides.createdAt ?? now,
		updatedAt: overrides.updatedAt ?? now,
		...overrides
	};
}

export function runProjectStoreConformance(opts: ProjectStoreConformanceOptions): void {
	const { name, createStore, runner, ctxIsolation = false } = opts;
	const { describe, it, expect } = runner;

	describe(`IProjectStore conformance: ${name}`, () => {
		// ============================================================================
		// Projects
		// ============================================================================

		it('createProject + getProject returns the project', async () => {
			const { store, orgId } = await createStore();
			const p = project(orgId, { id: 'p1' });
			await store.createProject(ctx('u1'), p);
			const got = await store.getProject(ctx('u1'), 'p1');
			expect(got?.name).toBe('Test Project');
		});

		it('getProject returns null for missing id', async () => {
			const { store } = await createStore();
			const got = await store.getProject(ctx('u1'), 'nonexistent');
			expect(got).toBeNull();
		});

		it('getProjectBySlug finds project by slug within org', async () => {
			const { store, orgId } = await createStore();
			await store.createProject(ctx('u1'), project(orgId, { id: 'p1', slug: 'my-proj' }));
			const got = await store.getProjectBySlug(ctx('u1'), orgId, 'my-proj');
			expect(got?.id).toBe('p1');
		});

		it('getProjectBySlug returns null for missing slug', async () => {
			const { store, orgId } = await createStore();
			const got = await store.getProjectBySlug(ctx('u1'), orgId, 'nonexistent');
			expect(got).toBeNull();
		});

		it('updateProject modifies name, slug, description, visibility', async () => {
			const { store, orgId } = await createStore();
			await store.createProject(ctx('u1'), project(orgId, { id: 'p1', slug: 'old', visibility: 'private' }));
			await store.updateProject(ctx('u1'), 'p1', { name: 'New Name', slug: 'new-slug', description: 'New desc', visibility: 'org' });
			const got = await store.getProject(ctx('u1'), 'p1');
			expect(got?.name).toBe('New Name');
			expect(got?.slug).toBe('new-slug');
			expect(got?.description).toBe('New desc');
			expect(got?.visibility).toBe('org');
		});

		it('deleteProject removes the project', async () => {
			const { store, orgId } = await createStore();
			await store.createProject(ctx('u1'), project(orgId, { id: 'p1' }));
			await store.deleteProject(ctx('u1'), 'p1');
			const got = await store.getProject(ctx('u1'), 'p1');
			expect(got).toBeNull();
		});

		it('listProjects returns projects for org with pagination', async () => {
			const { store, orgId } = await createStore();
			for (let i = 0; i < 3; i++) {
				await store.createProject(ctx('u1'), project(orgId, { id: `p${i}` }));
			}
			const page = await store.listProjects(ctx('u1'), orgId, { limit: 2 });
			expect(page.items.length).toBe(2);
		});

		// ============================================================================
		// Project Members
		// ============================================================================

		it('addProjectMember + getProjectMember returns the member', async () => {
			const { store, orgId } = await createStore();
			await store.createProject(ctx('u1'), project(orgId, { id: 'p1' }));
			const member: ProjectMember = { projectId: 'p1', userId: 'u2', role: 'editor', joinedAt: new Date().toISOString() };
			await store.addProjectMember(ctx('u1'), member);
			const got = await store.getProjectMember(ctx('u1'), 'p1', 'u2');
			expect(got?.role).toBe('editor');
		});

		it('getProjectMember returns null for missing member', async () => {
			const { store, orgId } = await createStore();
			await store.createProject(ctx('u1'), project(orgId, { id: 'p1' }));
			const got = await store.getProjectMember(ctx('u1'), 'p1', 'nonexistent');
			expect(got).toBeNull();
		});

		it('updateProjectMemberRole changes role', async () => {
			const { store, orgId } = await createStore();
			await store.createProject(ctx('u1'), project(orgId, { id: 'p1' }));
			await store.addProjectMember(ctx('u1'), { projectId: 'p1', userId: 'u2', role: 'viewer', joinedAt: new Date().toISOString() });
			await store.updateProjectMemberRole(ctx('u1'), 'p1', 'u2', 'editor');
			const got = await store.getProjectMember(ctx('u1'), 'p1', 'u2');
			expect(got?.role).toBe('editor');
		});

		it('removeProjectMember deletes the member', async () => {
			const { store, orgId } = await createStore();
			await store.createProject(ctx('u1'), project(orgId, { id: 'p1' }));
			await store.addProjectMember(ctx('u1'), { projectId: 'p1', userId: 'u2', role: 'editor', joinedAt: new Date().toISOString() });
			await store.removeProjectMember(ctx('u1'), 'p1', 'u2');
			const got = await store.getProjectMember(ctx('u1'), 'p1', 'u2');
			expect(got).toBeNull();
		});

		it('listProjectMembers returns members with pagination', async () => {
			const { store, orgId } = await createStore();
			await store.createProject(ctx('u1'), project(orgId, { id: 'p1' }));
			for (let i = 0; i < 3; i++) {
				await store.addProjectMember(ctx('u1'), { projectId: 'p1', userId: `u${i}`, role: 'viewer', joinedAt: new Date().toISOString() });
			}
			const page = await store.listProjectMembers(ctx('u1'), 'p1', { limit: 2 });
			expect(page.items.length).toBe(2);
		});

		if (ctxIsolation) {
			it('ctx isolation: projects created by one user are not visible to another', async () => {
				const { store, orgId } = await createStore();
				await store.createProject(ctx('user-a'), project(orgId, { id: 'p-a' }));

				const page = await store.listProjects(ctx('user-b'), orgId);
				expect(page.items.map((p) => p.id)).not.toContain('p-a');
			});

			it('ctx isolation: user cannot get a project they do not own', async () => {
				const { store, orgId } = await createStore();
				await store.createProject(ctx('user-a'), project(orgId, { id: 'p-a' }));

				const got = await store.getProject(ctx('user-b'), 'p-a');
				expect(got).toBeNull();
			});
		}
	});
}
