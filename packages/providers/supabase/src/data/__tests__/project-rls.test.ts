/**
 * RLS is supposed to re-enforce the access rules independently (`rules.ts:10`),
 * and finding 12 found it had drifted: the project mutation policies keyed on
 * `projects.owner_id` while `canManage` keys on member role. Those agree until
 * a Reclaim, which adds an owner-role member row and deliberately leaves
 * `owner_id` alone — after which the app layer authorizes an edit that RLS
 * rejects.
 *
 * Every user here is seeded with `seedPlainUser`, not `seedUser`. `seedUser`
 * promotes to `instance_admin`, and every policy in this file short-circuits on
 * `is_instance_admin()` — a test written with it passes no matter what the rest
 * of the policy says.
 *
 * Needs a live stack (`packages/providers/supabase/.env.test`); skips cleanly
 * without one.
 */

import { describe, beforeEach, it, expect } from 'vitest';
import { DEFAULT_ORG_PERMISSIONS, type Project, type RequestContext } from '@selvajs/platform';
import { SupabaseProjectStore } from '../SupabaseProjectStore.js';
import { readEnv, resetAllData, seedPlainUser } from './test-helpers.js';

const envCtx = readEnv();

if (!envCtx) {
	describe.skip('project RLS (skipped: no live stack)', () => {
		it('populate packages/providers/supabase/.env.test with Supabase creds to run these tests', () => {});
	});
} else {
	const env = envCtx;

	function ctxFor(userId: string, sessionToken: string, orgId: string): RequestContext {
		return {
			userId,
			actingOrgId: orgId,
			platformPermissions: [],
			orgPermissions: [...DEFAULT_ORG_PERMISSIONS.owner],
			adapterContext: { sessionToken }
		} as unknown as RequestContext;
	}

	/** An org with `creator` as its org owner, seeded past RLS via service-role. */
	async function seedOrg(creatorId: string): Promise<string> {
		const orgId = crypto.randomUUID();
		const now = new Date().toISOString();
		const { error } = await env.adminClient.from('orgs').insert({
			id: orgId,
			name: 'RLS Org',
			slug: `rls-${orgId.slice(0, 8)}`,
			owner_id: creatorId,
			created_at: now,
			updated_at: now
		});
		if (error) throw error;
		await addOrgMember(orgId, creatorId, 'owner');
		return orgId;
	}

	async function addOrgMember(
		orgId: string,
		userId: string,
		role: 'owner' | 'admin' | 'member'
	): Promise<void> {
		const { error } = await env.adminClient.from('org_members').insert({
			org_id: orgId,
			user_id: userId,
			role,
			permissions: [...DEFAULT_ORG_PERMISSIONS[role]],
			joined_at: new Date().toISOString()
		});
		if (error) throw error;
	}

	function draftProject(orgId: string, ownerId: string): Project {
		const now = new Date().toISOString();
		const id = crypto.randomUUID();
		return {
			id,
			orgId,
			name: `Project ${id.slice(0, 8)}`,
			slug: `project-${id.slice(0, 8)}`,
			description: undefined,
			visibility: 'private',
			ownerId,
			createdBy: ownerId,
			updatedBy: ownerId,
			autoJoinOnUpload: false,
			createdAt: now,
			updatedAt: now,
			deletedAt: null
		};
	}

	describe('project RLS mirrors the access rules', () => {
		beforeEach(async () => {
			await resetAllData(env);
		});

		it('lets a reclaiming org admin edit project settings afterwards', async () => {
			const store = new SupabaseProjectStore(env.bundle);
			const owner = await seedPlainUser(env, '');
			const orgId = await seedOrg(owner.userId);
			const ownerCtx = ctxFor(owner.userId, owner.sessionToken, orgId);

			const project = draftProject(orgId, owner.userId);
			await store.createProject(ownerCtx, project);

			// A second org admin — not the project owner, and never a member.
			const admin = await seedPlainUser(env, '');
			await addOrgMember(orgId, admin.userId, 'admin');
			const adminCtx = ctxFor(admin.userId, admin.sessionToken, orgId);

			// Exactly what POST /projects/{id}/reclaim writes: an owner-role member
			// row, with `projects.owner_id` deliberately left pointing at `owner`.
			await store.addProjectMember(adminCtx, {
				projectId: project.id,
				userId: admin.userId,
				role: 'owner',
				joinedAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				updatedBy: admin.userId,
				deletedAt: null
			});

			// The app layer says yes here — `canManage` is `member.role === 'owner'`.
			// Before this migration RLS said no, and the update failed.
			await store.updateProject(adminCtx, project.id, { name: 'Reclaimed' });

			const after = await store.getProject(adminCtx, project.id);
			expect(after?.name).toBe('Reclaimed');
			// The reclaim does not steal the project: `owner_id` is untouched, which
			// is the whole reason the old policy diverged.
			expect(after?.ownerId).toBe(owner.userId);
		});

		it('still refuses settings edits from a member who is not a project owner', async () => {
			const store = new SupabaseProjectStore(env.bundle);
			const owner = await seedPlainUser(env, '');
			const orgId = await seedOrg(owner.userId);
			const ownerCtx = ctxFor(owner.userId, owner.sessionToken, orgId);

			const project = draftProject(orgId, owner.userId);
			await store.createProject(ownerCtx, project);

			const editor = await seedPlainUser(env, '');
			await addOrgMember(orgId, editor.userId, 'member');
			await store.addProjectMember(ownerCtx, {
				projectId: project.id,
				userId: editor.userId,
				role: 'editor',
				joinedAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				updatedBy: owner.userId,
				deletedAt: null
			});
			const editorCtx = ctxFor(editor.userId, editor.sessionToken, orgId);

			// The control that keeps the fix honest: swapping `owner_id` for member
			// role must not widen the policy to any member. `updateProject` maps an
			// RLS-filtered update to a 404 — zero rows came back.
			await expect(
				store.updateProject(editorCtx, project.id, { name: 'Not Yours' })
			).rejects.toMatchObject({ statusCode: 404 });
		});

		it('hides the member roster of a public project from non-members', async () => {
			const store = new SupabaseProjectStore(env.bundle);
			const owner = await seedPlainUser(env, '');
			const orgId = await seedOrg(owner.userId);
			const ownerCtx = ctxFor(owner.userId, owner.sessionToken, orgId);

			const project = { ...draftProject(orgId, owner.userId), visibility: 'public' as const };
			await store.createProject(ownerCtx, project);

			// An org member who is not on the project. Under the old policy the
			// roster followed `visible_project`, so a public project exposed its
			// full membership to everyone who could see it.
			const outsider = await seedPlainUser(env, '');
			await addOrgMember(orgId, outsider.userId, 'member');
			const outsiderCtx = ctxFor(outsider.userId, outsider.sessionToken, orgId);

			expect((await store.getProject(outsiderCtx, project.id))?.id).toBe(project.id);
			const roster = await store.listProjectMembers(outsiderCtx, project.id);
			expect(roster.items).toHaveLength(0);
		});

		it('still shows the roster to a project member', async () => {
			const store = new SupabaseProjectStore(env.bundle);
			const owner = await seedPlainUser(env, '');
			const orgId = await seedOrg(owner.userId);
			const ownerCtx = ctxFor(owner.userId, owner.sessionToken, orgId);

			const project = { ...draftProject(orgId, owner.userId), visibility: 'public' as const };
			await store.createProject(ownerCtx, project);

			const roster = await store.listProjectMembers(ownerCtx, project.id);
			expect(roster.items.map((m) => m.userId)).toContain(owner.userId);
		});
	});
}
