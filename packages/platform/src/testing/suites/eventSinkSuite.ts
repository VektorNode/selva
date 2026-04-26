/**
 * Adapter conformance suite for the §9 event-sink contract.
 *
 * Verifies that each provider's stores emit the expected `DomainEvent` shape
 * after the corresponding mutation succeeds, and that emit happens AFTER the
 * write (so a failed write does not emit). Both reference providers run the
 * same suite — drift between Local and Supabase emission shape gets caught
 * immediately.
 *
 * Per Permissions.md §9 the events are no-op by default in v1; the suite
 * guarantees the seam exists and the shape is consistent so future webhook /
 * audit / analytics consumers can plug in by swapping the sink.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type {
	IDataProvider,
	DomainEvent,
	IEventSink,
	Organization,
	Project,
	OrgMember,
	DefinitionRecord,
	DefinitionVersion,
	ShareLink,
	RequestContext
} from '../../index.js';
import { ALL_ORG_PERMISSIONS, ALL_PLATFORM_PERMISSIONS } from '../../index.js';
import { makeUuid } from './helpers.js';

/** Records every event for assertion. Resets per test via `clear()`. */
export class RecordingEventSink implements IEventSink {
	readonly events: DomainEvent[] = [];

	async emit(event: DomainEvent): Promise<void> {
		this.events.push(event);
	}

	clear(): void {
		this.events.length = 0;
	}

	last(): DomainEvent | undefined {
		return this.events[this.events.length - 1];
	}

	ofType<T extends DomainEvent['type']>(type: T): Extract<DomainEvent, { type: T }>[] {
		return this.events.filter((e): e is Extract<DomainEvent, { type: T }> => e.type === type);
	}
}

export interface EventSinkConformanceOptions {
	name: string;
	/**
	 * Build a fresh data provider wired to the given sink. Adapters that need
	 * to seed FK-related state (Supabase: `auth.users` rows) do it here.
	 */
	createProvider: (sink: RecordingEventSink) => Promise<IDataProvider> | IDataProvider;
	/**
	 * The actor user id that mutations will be performed as. The suite needs
	 * this to be a real id in the adapter's auth backend (Supabase has FK).
	 * Local can return any uuid.
	 */
	createActorId: () => Promise<string> | string;
	/**
	 * Optional hook for cleaning up after the test (delete tempdir, truncate
	 * Supabase tables, etc.). Called once at the end of each test.
	 */
	cleanup?: () => Promise<void> | void;
}

export function runEventSinkConformance(opts: EventSinkConformanceOptions): void {
	const { name, createProvider, createActorId, cleanup } = opts;

	describe(`IEventSink conformance: ${name}`, () => {
		let sink: RecordingEventSink;
		let provider: IDataProvider;
		let actorId: string;
		let ctx: RequestContext;

		beforeEach(async () => {
			sink = new RecordingEventSink();
			provider = await createProvider(sink);
			actorId = await createActorId();
			ctx = {
				userId: actorId,
				platformPermissions: [...ALL_PLATFORM_PERMISSIONS],
				orgPermissions: [...ALL_ORG_PERMISSIONS]
			};
		});

		// Clean up after each test if the adapter supplies a hook. Always
		// registered (calling an undefined cleanup is the no-op path).
		afterEach(async () => {
			if (cleanup) await cleanup();
		});

		it('createOrg emits org.created', async () => {
			const orgId = makeUuid();
			await provider.orgs.createOrg(ctx, makeOrg({ id: orgId, ownerId: actorId }));

			const created = sink.ofType('org.created');
			expect(created).toHaveLength(1);
			expect(created[0]).toMatchObject({ orgId, actorId });
		});

		it('deleteOrg emits org.deleted', async () => {
			const orgId = makeUuid();
			await provider.orgs.createOrg(ctx, makeOrg({ id: orgId, ownerId: actorId }));
			sink.clear();

			await provider.orgs.deleteOrg(ctx, orgId);

			expect(sink.ofType('org.deleted')).toMatchObject([{ orgId, actorId }]);
		});

		it('addOrgMember emits org_member.added', async () => {
			const orgId = makeUuid();
			const newMemberId = await createActorId();
			await provider.orgs.createOrg(ctx, makeOrg({ id: orgId, ownerId: actorId }));
			sink.clear();

			await provider.orgs.addOrgMember(ctx, makeOrgMember({ orgId, userId: newMemberId }));

			expect(sink.ofType('org_member.added')).toMatchObject([
				{ orgId, userId: newMemberId, actorId }
			]);
		});

		it('removeOrgMember emits org_member.removed', async () => {
			const orgId = makeUuid();
			const newMemberId = await createActorId();
			await provider.orgs.createOrg(ctx, makeOrg({ id: orgId, ownerId: actorId }));
			await provider.orgs.addOrgMember(ctx, makeOrgMember({ orgId, userId: newMemberId }));
			sink.clear();

			await provider.orgs.removeOrgMember(ctx, orgId, newMemberId);

			expect(sink.ofType('org_member.removed')).toMatchObject([
				{ orgId, userId: newMemberId, actorId }
			]);
		});

		it('createProject emits project.created with the parent orgId', async () => {
			const orgId = makeUuid();
			const projectId = makeUuid();
			await provider.orgs.createOrg(ctx, makeOrg({ id: orgId, ownerId: actorId }));
			sink.clear();

			await provider.projects.createProject(
				ctx,
				makeProject({ id: projectId, orgId, ownerId: actorId })
			);

			expect(sink.ofType('project.created')).toMatchObject([{ projectId, orgId, actorId }]);
		});

		it('deleteProject emits project.deleted', async () => {
			const orgId = makeUuid();
			const projectId = makeUuid();
			await provider.orgs.createOrg(ctx, makeOrg({ id: orgId, ownerId: actorId }));
			await provider.projects.createProject(
				ctx,
				makeProject({ id: projectId, orgId, ownerId: actorId })
			);
			sink.clear();

			await provider.projects.deleteProject(ctx, projectId);

			expect(sink.ofType('project.deleted')).toMatchObject([{ projectId, actorId }]);
		});

		it('createDefinition + setLiveVersion emit created + published', async () => {
			const orgId = makeUuid();
			const projectId = makeUuid();
			const definitionId = makeUuid();
			const versionId = makeUuid();

			await provider.orgs.createOrg(ctx, makeOrg({ id: orgId, ownerId: actorId }));
			await provider.projects.createProject(
				ctx,
				makeProject({ id: projectId, orgId, ownerId: actorId })
			);
			sink.clear();

			await provider.definitions.create(
				ctx,
				makeDefinition({ guid: definitionId, projectId, ownerId: actorId })
			);
			await provider.definitions.createVersion(
				ctx,
				makeVersion({ id: versionId, definitionId, uploadedBy: actorId })
			);
			await provider.definitions.setLiveVersion(ctx, definitionId, versionId);

			expect(sink.ofType('definition.created')).toMatchObject([
				{ definitionId, projectId, actorId }
			]);
			expect(sink.ofType('definition_version.created')).toMatchObject([
				{ versionId, definitionId, actorId }
			]);
			expect(sink.ofType('definition.published')).toMatchObject([
				{ definitionId, versionId, actorId }
			]);
		});

		it('share-link create + revoke emit minted + revoked', async () => {
			const orgId = makeUuid();
			const projectId = makeUuid();
			const definitionId = makeUuid();
			const linkId = makeUuid();

			await provider.orgs.createOrg(ctx, makeOrg({ id: orgId, ownerId: actorId }));
			await provider.projects.createProject(
				ctx,
				makeProject({ id: projectId, orgId, ownerId: actorId })
			);
			await provider.definitions.create(
				ctx,
				makeDefinition({ guid: definitionId, projectId, ownerId: actorId })
			);
			sink.clear();

			await provider.shareLinks.create(
				ctx,
				makeShareLink({ id: linkId, definitionId, createdBy: actorId })
			);
			await provider.shareLinks.revoke(ctx, linkId);

			expect(sink.ofType('share_link.minted')).toMatchObject([{ linkId, definitionId, actorId }]);
			expect(sink.ofType('share_link.revoked')).toMatchObject([{ linkId, actorId }]);
		});

		it('failed write does not emit', async () => {
			const orgId = makeUuid();
			await provider.orgs.createOrg(ctx, makeOrg({ id: orgId, ownerId: actorId }));
			sink.clear();
			// Duplicate-id create must throw and must not emit.
			await expect(
				provider.orgs.createOrg(ctx, makeOrg({ id: orgId, ownerId: actorId }))
			).rejects.toThrow();
			expect(sink.ofType('org.created')).toHaveLength(0);
		});

		it('system-context mutations emit with actorId="system"', async () => {
			const sysCtx: RequestContext = {
				userId: '',
				platformPermissions: [...ALL_PLATFORM_PERMISSIONS],
				orgPermissions: [...ALL_ORG_PERMISSIONS],
				system: true
			};
			const orgId = makeUuid();
			await provider.orgs.createOrg(sysCtx, makeOrg({ id: orgId, ownerId: actorId }));

			const created = sink.ofType('org.created');
			expect(created).toHaveLength(1);
			expect(created[0].actorId).toBe('system');
		});
	});
}

// ============================================================================
// Test data helpers
// ============================================================================
function nowIso(): string {
	return new Date().toISOString();
}

function makeOrg(overrides: { id: string; ownerId: string }): Organization {
	const now = nowIso();
	return {
		id: overrides.id,
		name: `Org ${overrides.id.slice(0, 6)}`,
		slug: `org-${overrides.id.slice(0, 8)}`,
		ownerId: overrides.ownerId,
		createdBy: overrides.ownerId,
		updatedBy: overrides.ownerId,
		createdAt: now,
		updatedAt: now,
		deletedAt: null
	};
}

function makeOrgMember(overrides: { orgId: string; userId: string }): OrgMember {
	const now = nowIso();
	return {
		orgId: overrides.orgId,
		userId: overrides.userId,
		role: 'member',
		permissions: [],
		joinedAt: now,
		updatedAt: now,
		updatedBy: overrides.userId,
		deletedAt: null
	};
}

function makeProject(overrides: { id: string; orgId: string; ownerId: string }): Project {
	const now = nowIso();
	return {
		id: overrides.id,
		orgId: overrides.orgId,
		name: `Project ${overrides.id.slice(0, 6)}`,
		slug: `proj-${overrides.id.slice(0, 8)}`,
		visibility: 'private',
		autoJoinOnUpload: false,
		ownerId: overrides.ownerId,
		createdBy: overrides.ownerId,
		updatedBy: overrides.ownerId,
		createdAt: now,
		updatedAt: now,
		deletedAt: null
	};
}

function makeDefinition(overrides: {
	guid: string;
	projectId: string;
	ownerId: string;
}): DefinitionRecord {
	const now = nowIso();
	return {
		guid: overrides.guid,
		projectId: overrides.projectId,
		ownerId: overrides.ownerId,
		createdBy: overrides.ownerId,
		updatedBy: overrides.ownerId,
		displayName: `Def ${overrides.guid.slice(0, 6)}`,
		status: 'published',
		runCount: 0,
		liveVersionId: null,
		draftVersionId: null,
		createdAt: now,
		updatedAt: now,
		deletedAt: null
	};
}

function makeVersion(overrides: {
	id: string;
	definitionId: string;
	uploadedBy: string;
}): DefinitionVersion {
	return {
		id: overrides.id,
		definitionId: overrides.definitionId,
		versionNumber: 1,
		fileExt: 'gh',
		fileKey: `defs/${overrides.definitionId}/v/${overrides.id}/file.gh`,
		uploadedBy: overrides.uploadedBy,
		uploadedAt: nowIso()
	};
}

function makeShareLink(overrides: {
	id: string;
	definitionId: string;
	createdBy: string;
}): ShareLink {
	return {
		id: overrides.id,
		definitionId: overrides.definitionId,
		channel: 'live',
		tokenHash: `hash-${overrides.id}`,
		createdBy: overrides.createdBy,
		createdAt: nowIso(),
		expiresAt: null,
		revokedAt: null,
		allowSolve: true,
		maxSolves: null,
		solveCount: 0
	};
}
