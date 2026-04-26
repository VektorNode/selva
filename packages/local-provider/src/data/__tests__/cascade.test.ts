import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import {
	ALL_ORG_PERMISSIONS,
	ALL_PLATFORM_PERMISSIONS,
	SYSTEM_CONTEXT,
	type RequestContext,
	type DefinitionRecord,
	type ShareLink
} from '@selva/platform';
import { LocalOrgStore, LocalOrgStoreLoader } from '../LocalOrgStore.js';
import { LocalProjectStore } from '../LocalProjectStore.js';
import { LocalDefinitionStore } from '../LocalDefinitionStore.js';
import { LocalShareLinkStore } from '../LocalShareLinkStore.js';
import { LocalInviteStore } from '../LocalInviteStore.js';
import { LocalComputeServerStore } from '../LocalComputeServerStore.js';

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
		const invites = new LocalInviteStore(tempDir);
		const computeServer = new LocalComputeServerStore(path.join(tempDir, 'compute.config.json'));
		orgs = new LocalOrgStore(loader, invites, computeServer);
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
			permissions: [],
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
				permissions: [],
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

	it('share-link getByTokenHash returns null when parent definition is soft-deleted (§7)', async () => {
		// §7: token resolution MUST fail closed when its parent definition is
		// soft-deleted. Supabase enforces this via JOIN; the local store gets
		// the same behavior by injecting a definition provider through the
		// LocalDataProvider wiring (see LocalShareLinkStore.setDefinitionProvider).
		const ownerId = randomUUID();
		const orgId = randomUUID();
		const projectId = randomUUID();
		const definitionId = randomUUID();
		const linkId = randomUUID();
		const tokenHash = `hash-${randomUUID()}`;
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
		await projects.createProject(ownerCtx, {
			id: projectId,
			orgId,
			ownerId,
			name: 'P',
			slug: 'p',
			visibility: 'private',
			autoJoinOnUpload: false,
			createdBy: ownerId,
			updatedBy: ownerId,
			createdAt: now,
			updatedAt: now,
			deletedAt: null
		});

		const definitions = new LocalDefinitionStore(tempDir);
		const shareLinks = new LocalShareLinkStore(path.join(tempDir, 'share-links.json'));
		shareLinks.setDefinitionProvider(definitions);

		const definition: DefinitionRecord = {
			guid: definitionId,
			projectId,
			ownerId,
			createdBy: ownerId,
			updatedBy: ownerId,
			displayName: 'Def',
			status: 'published',
			runCount: 0,
			liveVersionId: null,
			draftVersionId: null,
			createdAt: now,
			updatedAt: now,
			deletedAt: null
		};
		await definitions.create(ownerCtx, definition);

		const link: ShareLink = {
			id: linkId,
			definitionId,
			channel: 'live',
			tokenHash,
			createdBy: ownerId,
			createdAt: now,
			expiresAt: null,
			revokedAt: null,
			allowSolve: true,
			maxSolves: null,
			solveCount: 0
		};
		await shareLinks.create(SYSTEM_CONTEXT, link);

		// Sanity: token resolves while parent is live.
		expect(await shareLinks.getByTokenHash(SYSTEM_CONTEXT, tokenHash)).not.toBeNull();

		// Soft-delete the parent definition.
		await definitions.delete(ownerCtx, definitionId);

		// Cascade contract: token resolution must now fail closed.
		expect(await shareLinks.getByTokenHash(SYSTEM_CONTEXT, tokenHash)).toBeNull();
	});
});
