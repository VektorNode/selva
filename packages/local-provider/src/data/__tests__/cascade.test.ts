import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import {
	ALL_ORG_PERMISSIONS,
	ALL_PLATFORM_PERMISSIONS,
	type RequestContext
} from '@selva/platform';
import { LocalOrgStore, LocalOrgStoreLoader } from '../LocalOrgStore.js';
import { LocalProjectStore } from '../LocalProjectStore.js';

/**
 * Cross-store cascade behavior. Lives outside the per-store conformance suites
 * because the invariants involve both `IOrgStore` and `IProjectStore`.
 */
describe('Cross-store cascade', () => {
	let tempDir: string;
	let orgs: LocalOrgStore;
	let projects: LocalProjectStore;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-test-'));
		const loader = new LocalOrgStoreLoader(tempDir);
		orgs = new LocalOrgStore(loader);
		projects = new LocalProjectStore(loader);
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	function ctxFor(userId: string): RequestContext {
		return {
			userId,
			platformPermissions: [...ALL_PLATFORM_PERMISSIONS],
			orgPermissions: [...ALL_ORG_PERMISSIONS]
		};
	}

	it('removeOrgMember soft-deletes the user’s project memberships in that org (§9)', async () => {
		const ownerId = randomUUID();
		const memberId = randomUUID();
		const orgId = randomUUID();
		const projectAId = randomUUID();
		const projectBId = randomUUID();
		const now = new Date().toISOString();
		const ownerCtx = ctxFor(ownerId);

		await orgs.createOrg(ownerCtx, {
			id: orgId,
			name: 'Acme',
			slug: 'acme',
			ownerId,
			createdBy: ownerId,
			updatedBy: ownerId,
			createdAt: now,
			updatedAt: now,
			deletedAt: null
		});
		await orgs.addOrgMember(ownerCtx, {
			orgId,
			userId: memberId,
			role: 'member',
			joinedAt: now,
			updatedAt: now,
			updatedBy: ownerId,
			deletedAt: null
		});

		for (const id of [projectAId, projectBId]) {
			await projects.createProject(ownerCtx, {
				id,
				orgId,
				ownerId,
				name: `Project ${id.slice(0, 4)}`,
				slug: `p-${id.slice(0, 4)}`,
				visibility: 'private',
				autoJoinOnUpload: false,
				allowAnonymous: false,
				createdBy: ownerId,
				updatedBy: ownerId,
				createdAt: now,
				updatedAt: now,
				deletedAt: null
			});
			await projects.addProjectMember(ownerCtx, {
				projectId: id,
				userId: memberId,
				role: 'editor',
				joinedAt: now,
				updatedAt: now,
				updatedBy: ownerId,
				deletedAt: null
			});
		}

		// Sanity: memberships are live before the cascade fires.
		expect(await projects.getProjectMember(ownerCtx, projectAId, memberId)).not.toBeNull();
		expect(await projects.getProjectMember(ownerCtx, projectBId, memberId)).not.toBeNull();

		await orgs.removeOrgMember(ownerCtx, orgId, memberId);

		expect(await orgs.getOrgMember(ownerCtx, orgId, memberId)).toBeNull();
		expect(await projects.getProjectMember(ownerCtx, projectAId, memberId)).toBeNull();
		expect(await projects.getProjectMember(ownerCtx, projectBId, memberId)).toBeNull();
	});

	it('removeOrgMember does not touch project memberships in other orgs', async () => {
		const ownerAId = randomUUID();
		const ownerBId = randomUUID();
		const memberId = randomUUID();
		const orgAId = randomUUID();
		const orgBId = randomUUID();
		const projectAId = randomUUID();
		const projectBId = randomUUID();
		const now = new Date().toISOString();

		await orgs.createOrg(ctxFor(ownerAId), {
			id: orgAId,
			name: 'Acme',
			slug: 'acme',
			ownerId: ownerAId,
			createdBy: ownerAId,
			updatedBy: ownerAId,
			createdAt: now,
			updatedAt: now,
			deletedAt: null
		});
		await orgs.createOrg(ctxFor(ownerBId), {
			id: orgBId,
			name: 'BigClient',
			slug: 'bigclient',
			ownerId: ownerBId,
			createdBy: ownerBId,
			updatedBy: ownerBId,
			createdAt: now,
			updatedAt: now,
			deletedAt: null
		});

		for (const [orgOwner, orgId] of [
			[ownerAId, orgAId],
			[ownerBId, orgBId]
		]) {
			await orgs.addOrgMember(ctxFor(orgOwner), {
				orgId,
				userId: memberId,
				role: 'member',
				joinedAt: now,
				updatedAt: now,
				updatedBy: orgOwner,
				deletedAt: null
			});
		}

		for (const [orgOwner, orgId, projectId] of [
			[ownerAId, orgAId, projectAId],
			[ownerBId, orgBId, projectBId]
		]) {
			await projects.createProject(ctxFor(orgOwner), {
				id: projectId,
				orgId,
				ownerId: orgOwner,
				name: `Project ${projectId.slice(0, 4)}`,
				slug: `p-${projectId.slice(0, 4)}`,
				visibility: 'private',
				autoJoinOnUpload: false,
				allowAnonymous: false,
				createdBy: orgOwner,
				updatedBy: orgOwner,
				createdAt: now,
				updatedAt: now,
				deletedAt: null
			});
			await projects.addProjectMember(ctxFor(orgOwner), {
				projectId,
				userId: memberId,
				role: 'editor',
				joinedAt: now,
				updatedAt: now,
				updatedBy: orgOwner,
				deletedAt: null
			});
		}

		// Remove from org A only.
		await orgs.removeOrgMember(ctxFor(ownerAId), orgAId, memberId);

		expect(await projects.getProjectMember(ctxFor(ownerAId), projectAId, memberId)).toBeNull();
		// Org B membership and its project membership are untouched.
		expect(await orgs.getOrgMember(ctxFor(ownerBId), orgBId, memberId)).not.toBeNull();
		expect(await projects.getProjectMember(ctxFor(ownerBId), projectBId, memberId)).not.toBeNull();
	});
});
