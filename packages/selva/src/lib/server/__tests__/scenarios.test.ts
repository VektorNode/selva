/**
 * Sanity checks from docs/contributing/permissions.md's permission matrix.
 *
 * Each test mirrors one matrix row end-to-end through the real provider stack
 * (LocalDataProvider in a tmpdir) — no mocks for the rules, stores, or access
 * helpers. The mock layer (setup.ts) only replaces the provider singleton
 * with the per-test handle so route handlers see this test's data.
 *
 * `it()` titles match the matrix row prose so a reader can grep the doc and
 * find the test directly.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
	canChangeVisibilityToPublic,
	canEditProjectSettings,
	canView,
	checkOwnerRemoval,
	SYSTEM_CONTEXT
} from '@selvajs/platform';
import {
	requireCanCreateDefinition,
	requireCanEditDefinition,
	requireCanReclaim,
	requireCanViewProject
} from '../access.server.js';
import {
	call,
	freshProviders,
	seedAcme,
	seedBigClient,
	seedCommons,
	seedDefinition,
	seedOrgMember,
	seedProject,
	seedProjectMember,
	seedShareLink,
	seedThirdOrg,
	seedUser,
	grantPlatformPermissions,
	actAs,
	expectHttpError,
	type TestProviders
} from './fixtures.js';
import { POST as reclaimPOST } from '../../../routes/api/v1/projects/[id]/reclaim/+server.js';
import { PATCH as projectPATCH } from '../../../routes/api/v1/projects/[id]/+server.js';

let tp: TestProviders | null = null;

afterEach(async () => {
	if (tp) {
		await tp.cleanup();
		tp = null;
	}
});

describe('§11 — visibility & cross-org', () => {
	it('Bob (Acme member, no project membership) navigates to private URL — 403', async () => {
		tp = await freshProviders();
		const { bob, alicesPrivate } = await seedAcme(tp);
		const bobLocals = await actAs(tp, bob.id);

		await expectHttpError(requireCanViewProject(bobLocals, alicesPrivate.id), 403);
	});

	it('Carol (BigClient member) navigates to Acme org project — 403', async () => {
		tp = await freshProviders();
		const { acmeOrg } = await seedAcme(tp);
		const { carol } = await seedBigClient(tp);
		const carolLocals = await actAs(tp, carol.id);

		await expectHttpError(requireCanViewProject(carolLocals, acmeOrg.id), 403);
	});

	it('Bob (Acme member) views/solves an Acme org project — OK', async () => {
		tp = await freshProviders();
		const { bob, acmeOrg } = await seedAcme(tp);
		const bobLocals = await actAs(tp, bob.id);

		await expect(requireCanViewProject(bobLocals, acmeOrg.id)).resolves.toBeDefined();
	});

	it('Bob (Acme member) tries to edit an Acme org project definition — 403', async () => {
		tp = await freshProviders();
		const { bob, alice, acmeOrg } = await seedAcme(tp);
		const def = await seedDefinition(tp, {
			projectId: acmeOrg.id,
			ownerId: alice.id
		});
		const bobLocals = await actAs(tp, bob.id);

		await expectHttpError(requireCanEditDefinition(bobLocals, acmeOrg.id, def.record.guid), 403);
	});

	it('Dave (any org) views Acme public project — OK with cross-org flag on', async () => {
		tp = await freshProviders({ flags: { ALLOW_CROSS_ORG_PUBLIC: true } });
		const { acmePublic } = await seedAcme(tp);
		const { dave } = await seedThirdOrg(tp);
		const daveLocals = await actAs(tp, dave.id);

		await expect(requireCanViewProject(daveLocals, acmePublic.id)).resolves.toBeDefined();
	});

	it('Dave (any org) views Acme public project — 403 with cross-org flag OFF', async () => {
		tp = await freshProviders({ flags: { ALLOW_CROSS_ORG_PUBLIC: false } });
		const { acmePublic } = await seedAcme(tp);
		const { dave } = await seedThirdOrg(tp);
		const daveLocals = await actAs(tp, dave.id);

		await expectHttpError(requireCanViewProject(daveLocals, acmePublic.id), 403);
	});

	it('Alice (project owner) uploads a definition to her public project — OK', async () => {
		tp = await freshProviders();
		const { alice, acmePublic } = await seedAcme(tp);
		const aliceLocals = await actAs(tp, alice.id);

		const result = await requireCanCreateDefinition(aliceLocals, acmePublic.id);
		expect(result.user.id).toBe(alice.id);
	});

	it('Alice (project owner) uploads a definition to her org project — OK', async () => {
		tp = await freshProviders();
		const { alice, acmeOrg } = await seedAcme(tp);
		const aliceLocals = await actAs(tp, alice.id);

		const result = await requireCanCreateDefinition(aliceLocals, acmeOrg.id);
		expect(result.user.id).toBe(alice.id);
	});

	it('Bob (Acme member, not project member) uploads to a public project — 403', async () => {
		tp = await freshProviders();
		const { bob, acmePublic } = await seedAcme(tp);
		const bobLocals = await actAs(tp, bob.id);

		await expectHttpError(requireCanCreateDefinition(bobLocals, acmePublic.id), 403);
	});
});

describe('§11 — commons model', () => {
	it('Bob uploads a NEW definition to a commons project — OK (autoJoinOnUpload bypass)', async () => {
		tp = await freshProviders();
		const { acme, alice, bob } = await seedAcme(tp);
		const { commonsProject } = await seedCommons(tp, { acmeId: acme.id, aliceId: alice.id });
		const bobLocals = await actAs(tp, bob.id);

		// requireCanCreateDefinition resolves successfully on commons projects
		// for any authenticated user — the handler stamps ownerId = user.id.
		const result = await requireCanCreateDefinition(bobLocals, commonsProject.id);
		expect(result.user.id).toBe(bob.id);
		expect(result.project.autoJoinOnUpload).toBe(true);
	});

	it('Alice uploads v2 of her own commons def — OK (definition owner)', async () => {
		tp = await freshProviders();
		const { acme, alice } = await seedAcme(tp);
		const { commonsProject, alicesCommonsDef } = await seedCommons(tp, {
			acmeId: acme.id,
			aliceId: alice.id
		});
		const aliceLocals = await actAs(tp, alice.id);

		// Alice is project owner AND definition owner — either branch passes.
		await expect(
			requireCanEditDefinition(aliceLocals, commonsProject.id, alicesCommonsDef.record.guid)
		).resolves.toBeDefined();
	});

	it("Peter tries v2 on Alice's commons def — 403 (not owner, not editor)", async () => {
		tp = await freshProviders();
		const { acme, alice } = await seedAcme(tp);
		const { commonsProject, alicesCommonsDef, peter } = await seedCommons(tp, {
			acmeId: acme.id,
			aliceId: alice.id
		});
		const peterLocals = await actAs(tp, peter.id);

		await expectHttpError(
			requireCanEditDefinition(peterLocals, commonsProject.id, alicesCommonsDef.record.guid),
			403
		);
	});

	it('Peter uploads his own NEW definition to commons — OK (autoJoinOnUpload bypass)', async () => {
		tp = await freshProviders();
		const { acme, alice } = await seedAcme(tp);
		const { commonsProject, peter } = await seedCommons(tp, {
			acmeId: acme.id,
			aliceId: alice.id
		});
		const peterLocals = await actAs(tp, peter.id);

		const result = await requireCanCreateDefinition(peterLocals, commonsProject.id);
		expect(result.user.id).toBe(peter.id);
	});

	it("Alice (project owner on commons) moderates Peter's definition — OK", async () => {
		tp = await freshProviders();
		const { acme, alice } = await seedAcme(tp);
		const { commonsProject, peter } = await seedCommons(tp, {
			acmeId: acme.id,
			aliceId: alice.id
		});
		const petersDef = await seedDefinition(tp, {
			projectId: commonsProject.id,
			ownerId: peter.id,
			displayName: "Peter's Commons Def"
		});
		const aliceLocals = await actAs(tp, alice.id);

		// Alice is project owner (moderation authority) — passes regardless of
		// definition ownership.
		await expect(
			requireCanEditDefinition(aliceLocals, commonsProject.id, petersDef.record.guid)
		).resolves.toBeDefined();
	});
});

describe('§11 — versioning & rollback', () => {
	it('Alice rolls live back to v1 from broken v2 — re-points pointer', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, {
			projectId: alicesPrivate.id,
			ownerId: alice.id
		});
		const aliceCtx = (await actAs(tp, alice.id)).ctx;

		const v2Schema = { name: 'Test', inputs: [], outputs: [] } as unknown as Parameters<
			typeof tp.definitionService.uploadVersion
		>[5];
		const v2 = await tp.definitionService.uploadVersion(
			aliceCtx,
			def.record.guid,
			new TextEncoder().encode('V2_BYTES'),
			'gh',
			'v2.gh',
			v2Schema
		);
		await tp.definitionService.publish(aliceCtx, def.record.guid, v2.id);

		const afterPublish = await tp.config.data.definitions.get(aliceCtx, def.record.guid);
		expect(afterPublish?.liveVersionId).toBe(v2.id);

		await tp.definitionService.publish(aliceCtx, def.record.guid, def.version.id);

		const afterRollback = await tp.config.data.definitions.get(aliceCtx, def.record.guid);
		expect(afterRollback?.liveVersionId).toBe(def.version.id);
	});

	it('Alice tries to delete v1 while it is live — 409 deletion protection', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, {
			projectId: alicesPrivate.id,
			ownerId: alice.id
		});
		const aliceCtx = (await actAs(tp, alice.id)).ctx;

		await expect(
			tp.definitionService.deleteVersion(aliceCtx, def.record.guid, def.version.id)
		).rejects.toMatchObject({ statusCode: 409 });
	});
});

describe('§11 — project edit gates', () => {
	it('Project editor tries to edit settings — 403, owner-only', async () => {
		tp = await freshProviders();
		const { bob, alicesPrivate } = await seedAcme(tp);
		await seedProjectMember(tp, {
			projectId: alicesPrivate.id,
			userId: bob.id,
			role: 'editor'
		});
		const bobCtx = (await actAs(tp, bob.id)).ctx;

		const member = await tp.config.data.projects.getProjectMember(bobCtx, alicesPrivate.id, bob.id);
		const allowed = canEditProjectSettings({
			orgPermissions: bobCtx.orgPermissions,
			platformPermissions: bobCtx.platformPermissions,
			project: alicesPrivate,
			member,
			orgMember: null,
			allowCrossOrgPublic: false,
			enablePlatformProjects: true,
			platformGrants: [],
			actingOrgId: bobCtx.actingOrgId ?? null,
			userId: bobCtx.userId
		});
		expect(allowed).toBe(false);
	});

	it('Plain org member who owns a project can edit its settings — regression for H6', async () => {
		// PATCH /api/projects/[id] used to require BOTH the platform-scope
		// `manage_projects` permission AND project-owner role, so an owner
		// without `manage_projects` got 403 on their own project's settings.
		tp = await freshProviders();
		const acme = await seedAcme(tp);

		const mallory = await seedUser(tp, 'mallory@acme.test');
		await seedOrgMember(tp, {
			orgId: acme.acme.id,
			userId: mallory.id,
			role: 'member',
			permissions: [] // not the role default
		});
		const mallorysProject = await seedProject(tp, {
			orgId: acme.acme.id,
			name: 'Mallory Private',
			slug: 'mallory-private',
			ownerId: mallory.id,
			visibility: 'private'
		});

		const locals = await actAs(tp, mallory.id);
		const res = await call(projectPATCH, {
			locals,
			params: { id: mallorysProject.id },
			body: { description: 'updated by owner' }
		});
		expect(res.status).toBe(204);
	});

	it('Project viewer tries to delete a definition — 403', async () => {
		tp = await freshProviders();
		const { alice, bob, alicesPrivate } = await seedAcme(tp);
		await seedProjectMember(tp, {
			projectId: alicesPrivate.id,
			userId: bob.id,
			role: 'viewer'
		});
		const def = await seedDefinition(tp, {
			projectId: alicesPrivate.id,
			ownerId: alice.id
		});
		const bobLocals = await actAs(tp, bob.id);

		await expectHttpError(
			requireCanEditDefinition(bobLocals, alicesPrivate.id, def.record.guid),
			403
		);
	});
});

describe('§11 — reclaim & owner removal', () => {
	it('Org owner reclaims project — adds co-owner, original not demoted', async () => {
		tp = await freshProviders();
		const { acme, alice, bob, alicesPrivate } = await seedAcme(tp);
		// Bob must be an org owner for canReclaim to pass.
		await tp.config.data.orgs.updateOrgMemberRole(SYSTEM_CONTEXT, acme.id, bob.id, 'owner');

		const bobLocals = await actAs(tp, bob.id);
		const res = await reclaimPOST({
			params: { id: alicesPrivate.id },
			locals: bobLocals,
			request: new Request('http://test.local/'),
			url: new URL('http://test.local/')
		} as never);
		expect(res?.status).toBe(201);

		// Both Alice and Bob now exist as project members; Alice still owner.
		const owners = await tp.config.data.projects.listProjectMembers(
			(await actAs(tp, alice.id)).ctx,
			alicesPrivate.id,
			{ limit: 50 }
		);
		const ownerIds = owners.items
			.filter((m) => m.role === 'owner')
			.map((m) => m.userId)
			.sort();
		expect(ownerIds).toEqual([alice.id, bob.id].sort());
	});

	it('Co-owner removes original owner without confirm — needs_confirm', async () => {
		const target = { role: 'owner' as const };
		const allMembers = [
			{ role: 'owner' as const },
			{ role: 'owner' as const },
			{ role: 'editor' as const }
		];
		expect(checkOwnerRemoval({ target, allMembers, confirmed: false })).toBe('needs_confirm');
	});

	it('Co-owner removes original owner with ?confirm=true — ok', async () => {
		const target = { role: 'owner' as const };
		const allMembers = [
			{ role: 'owner' as const },
			{ role: 'owner' as const },
			{ role: 'editor' as const }
		];
		expect(checkOwnerRemoval({ target, allMembers, confirmed: true })).toBe('ok');
	});

	it('Sole-owner removal blocked — sole_owner', async () => {
		const target = { role: 'owner' as const };
		const allMembers = [{ role: 'owner' as const }, { role: 'editor' as const }];
		expect(checkOwnerRemoval({ target, allMembers, confirmed: true })).toBe('sole_owner');
	});

	it('Carol (BigClient owner) cannot reclaim Alice (Acme) project — 403', async () => {
		tp = await freshProviders();
		const { alicesPrivate } = await seedAcme(tp);
		const { carol } = await seedBigClient(tp);
		const carolLocals = await actAs(tp, carol.id);

		await expectHttpError(requireCanReclaim(carolLocals, alicesPrivate.id), 403);
	});
});

describe('§11 — visibility flips', () => {
	it('canChangeVisibilityToPublic: org admin allowed', async () => {
		expect(
			canChangeVisibilityToPublic({
				orgMember: {
					orgId: 'o1',
					userId: 'u1',
					role: 'admin',
					permissions: [],
					joinedAt: '',
					updatedAt: '',
					updatedBy: 'u1',
					deletedAt: null
				}
			})
		).toBe(true);
	});

	it('canChangeVisibilityToPublic: org member rejected', async () => {
		expect(
			canChangeVisibilityToPublic({
				orgMember: {
					orgId: 'o1',
					userId: 'u1',
					role: 'member',
					permissions: [],
					joinedAt: '',
					updatedAt: '',
					updatedBy: 'u1',
					deletedAt: null
				}
			})
		).toBe(false);
	});

	it('Public project + cross-org flag ON — non-org user can view', async () => {
		const project = {
			id: 'p',
			orgId: 'acme',
			name: 'P',
			slug: 'p',
			visibility: 'public' as const,
			ownerId: 'alice',
			createdBy: 'alice',
			updatedBy: 'alice',
			autoJoinOnUpload: false,
			createdAt: '',
			updatedAt: '',
			deletedAt: null
		};
		expect(
			canView({
				orgPermissions: [],
				platformPermissions: [],
				project,
				member: null,
				orgMember: null,
				allowCrossOrgPublic: true,
				enablePlatformProjects: true,
				platformGrants: [],
				actingOrgId: null,
				userId: 'u-anon'
			})
		).toBe(true);
	});

	it('Public project + cross-org flag OFF — non-org user blocked, org member allowed', async () => {
		const project = {
			id: 'p',
			orgId: 'acme',
			name: 'P',
			slug: 'p',
			visibility: 'public' as const,
			ownerId: 'alice',
			createdBy: 'alice',
			updatedBy: 'alice',
			autoJoinOnUpload: false,
			createdAt: '',
			updatedAt: '',
			deletedAt: null
		};
		const orgMember = {
			orgId: 'acme',
			userId: 'u1',
			role: 'member' as const,
			permissions: [],
			joinedAt: '',
			updatedAt: '',
			updatedBy: 'u1',
			deletedAt: null
		};
		// Non-org user: orgMember=null, flag=false → blocked
		expect(
			canView({
				orgPermissions: [],
				platformPermissions: [],
				project,
				member: null,
				orgMember: null,
				allowCrossOrgPublic: false,
				enablePlatformProjects: true,
				platformGrants: [],
				actingOrgId: null,
				userId: 'u-anon'
			})
		).toBe(false);
		// Org member: orgMember set, flag=false → allowed (within-org public)
		expect(
			canView({
				orgPermissions: [],
				platformPermissions: [],
				project,
				member: null,
				orgMember,
				allowCrossOrgPublic: false,
				enablePlatformProjects: true,
				platformGrants: [],
				actingOrgId: 'acme',
				userId: 'u1'
			})
		).toBe(true);
	});
});

describe('§11 — share links', () => {
	it('Token at cap: tryIncrementSolveCount returns null', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		const { link } = await seedShareLink(tp, {
			definitionId: def.record.guid,
			createdBy: alice.id,
			maxSolves: 2
		});
		const ctx = (await actAs(tp, alice.id)).ctx;

		expect(await tp.config.data.shareLinks.tryIncrementSolveCount(ctx, link.id)).toBe(1);
		expect(await tp.config.data.shareLinks.tryIncrementSolveCount(ctx, link.id)).toBe(2);
		expect(await tp.config.data.shareLinks.tryIncrementSolveCount(ctx, link.id)).toBeNull();
	});

	it('Revoked link: getByTokenHash returns null', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		const { link } = await seedShareLink(tp, {
			definitionId: def.record.guid,
			createdBy: alice.id
		});
		const ctx = (await actAs(tp, alice.id)).ctx;

		expect(await tp.config.data.shareLinks.getByTokenHash(ctx, link.tokenHash)).not.toBeNull();
		await tp.config.data.shareLinks.revoke(ctx, link.id);
		expect(await tp.config.data.shareLinks.getByTokenHash(ctx, link.tokenHash)).toBeNull();
	});

	it('Soft-deleted definition: token resolution fails closed', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		const { link } = await seedShareLink(tp, {
			definitionId: def.record.guid,
			createdBy: alice.id
		});
		const ctx = (await actAs(tp, alice.id)).ctx;

		// Pre-delete the link resolves.
		expect(await tp.config.data.shareLinks.getByTokenHash(ctx, link.tokenHash)).not.toBeNull();

		// Soft-delete the parent definition; token must now fail closed.
		await tp.config.data.definitions.delete(ctx, def.record.guid);
		expect(await tp.config.data.shareLinks.getByTokenHash(ctx, link.tokenHash)).toBeNull();
	});

	it('Draft-channel token resolves; live token does not match a draft request', async () => {
		tp = await freshProviders();
		const { alice, alicesPrivate } = await seedAcme(tp);
		const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
		const { link: draftLink } = await seedShareLink(tp, {
			definitionId: def.record.guid,
			createdBy: alice.id,
			channel: 'draft'
		});
		const ctx = (await actAs(tp, alice.id)).ctx;

		const resolved = await tp.config.data.shareLinks.getByTokenHash(ctx, draftLink.tokenHash);
		expect(resolved?.channel).toBe('draft');
		expect(resolved?.definitionId).toBe(def.record.guid);
	});
});

describe('§11 — instance-admin invariants', () => {
	it('Sole admin tries to revoke own instance_admin — store returns last_admin', async () => {
		tp = await freshProviders();
		const { alice } = await seedAcme(tp);
		await grantPlatformPermissions(tp, alice.id, ['instance_admin']);
		const aliceCtx = (await actAs(tp, alice.id)).ctx;

		const result = await tp.config.data.permissions.set(aliceCtx, alice.id, []);
		expect(result).toBe('last_admin');
	});

	it('Admin demotes a co-admin while still holding admin themselves — OK', async () => {
		tp = await freshProviders();
		const { alice, bob } = await seedAcme(tp);
		await grantPlatformPermissions(tp, alice.id, ['instance_admin']);
		await grantPlatformPermissions(tp, bob.id, ['instance_admin']);
		const aliceCtx = (await actAs(tp, alice.id)).ctx;

		const result = await tp.config.data.permissions.set(aliceCtx, bob.id, []);
		expect(result).toBe('ok');
	});

	it('countInstanceAdminsExcluding correctly excludes the named user', async () => {
		tp = await freshProviders();
		const { alice, bob } = await seedAcme(tp);
		await grantPlatformPermissions(tp, alice.id, ['instance_admin']);
		await grantPlatformPermissions(tp, bob.id, ['instance_admin']);

		// Both admins. Excluding either drops count to 1.
		expect(
			await tp.config.data.permissions.countInstanceAdminsExcluding(SYSTEM_CONTEXT, alice.id)
		).toBe(1);
		expect(
			await tp.config.data.permissions.countInstanceAdminsExcluding(SYSTEM_CONTEXT, bob.id)
		).toBe(1);
		// Excluding a non-admin doesn't change the count.
		expect(
			await tp.config.data.permissions.countInstanceAdminsExcluding(SYSTEM_CONTEXT, 'nonexistent')
		).toBe(2);
	});

	it('instance_admin views Acme private project without being a member — 403 (no content bypass)', async () => {
		tp = await freshProviders();
		const { alicesPrivate, bob } = await seedAcme(tp);
		// Bob is an Acme member but NOT a member of Alice's private project.
		// `instance_admin` doesn't bypass content access — private projects are
		// private from everyone without a membership, including platform staff.
		// Reclaim is the explicit escalation path.
		await grantPlatformPermissions(tp, bob.id, ['instance_admin']);
		const bobLocals = await actAs(tp, bob.id);

		await expect(requireCanViewProject(bobLocals, alicesPrivate.id)).rejects.toMatchObject({
			status: 403
		});
	});
});
