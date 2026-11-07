/**
 * Adapter conformance suite for the event-sink contract: a provider's stores
 * emit the expected `DomainEvent` after a mutation succeeds, and a failed write
 * emits nothing. The provider is handed a `RecordingEventSink`, so every adapter
 * is held to the same event shapes.
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
import { ALL_PLATFORM_PERMISSIONS, SYSTEM_CONTEXT } from '../../index.js';
import { makeCtx, makeExpectDenied, makeUuid } from './helpers.js';

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
	 *
	 * `sessionToken` is required for adapters with DB-side auth (Supabase RLS)
	 * so the per-test `ctx` runs as that authenticated user. Local can omit.
	 */
	createActorId: () => Promise<{ userId: string; sessionToken?: string }>;
	/**
	 * Optional hook for cleaning up after the test (delete tempdir, truncate
	 * Supabase tables, etc.). Called once at the end of each test.
	 */
	cleanup?: () => Promise<void> | void;
	/** Denials assert the `ProviderError` status (409 for a duplicate id), not just a rejection. */
	strictDenials?: boolean;
	/** A delete that changes nothing (a missing or already-deleted definition) emits nothing. */
	silentNoops?: boolean;
	/**
	 * The adapter's own sink, with its backend broken so writes fail. When present, a
	 * case proves `emit` still resolves: a throw would surface as a failed write after
	 * the mutation committed.
	 */
	createFailingSink?: () => Promise<IEventSink> | IEventSink;
}

export function runEventSinkConformance(opts: EventSinkConformanceOptions): void {
	const {
		name,
		createProvider,
		createActorId,
		cleanup,
		strictDenials = false,
		silentNoops = false,
		createFailingSink
	} = opts;
	const expectDenied = makeExpectDenied(strictDenials);

	describe(`IEventSink conformance: ${name}`, () => {
		let sink: RecordingEventSink;
		let provider: IDataProvider;
		let actorId: string;
		let ctx: RequestContext;

		beforeEach(async () => {
			sink = new RecordingEventSink();
			provider = await createProvider(sink);
			const seeded = await createActorId();
			actorId = seeded.userId;
			ctx = makeCtx(actorId, {
				platformPermissions: [...ALL_PLATFORM_PERMISSIONS],
				sessionToken: seeded.sessionToken
			});
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
			const { userId: newMemberId } = await createActorId();
			await provider.orgs.createOrg(ctx, makeOrg({ id: orgId, ownerId: actorId }));
			sink.clear();

			await provider.orgs.addOrgMember(ctx, makeOrgMember({ orgId, userId: newMemberId }));

			expect(sink.ofType('org_member.added')).toMatchObject([
				{ orgId, userId: newMemberId, actorId }
			]);
		});

		it('removeOrgMember emits org_member.removed', async () => {
			const orgId = makeUuid();
			const { userId: newMemberId } = await createActorId();
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
			await expectDenied(
				provider.orgs.createOrg(ctx, makeOrg({ id: orgId, ownerId: actorId })),
				409
			);
			expect(sink.ofType('org.created')).toHaveLength(0);
		});

		if (silentNoops) {
			it('deleting a missing or already-deleted definition emits nothing', async () => {
				const orgId = makeUuid();
				const projectId = makeUuid();
				const definitionId = makeUuid();
				await provider.orgs.createOrg(ctx, makeOrg({ id: orgId, ownerId: actorId }));
				await provider.projects.createProject(
					ctx,
					makeProject({ id: projectId, orgId, ownerId: actorId })
				);
				await provider.definitions.create(
					ctx,
					makeDefinition({ guid: definitionId, projectId, ownerId: actorId })
				);
				await provider.definitions.delete(ctx, definitionId);
				sink.clear();

				await provider.definitions.delete(ctx, definitionId);
				await provider.definitions.delete(ctx, makeUuid());

				expect(sink.ofType('definition.deleted')).toHaveLength(0);
			});
		}

		if (createFailingSink) {
			it('emit resolves when the sink’s backend fails', async () => {
				const failing = await createFailingSink();
				await expect(
					failing.emit({ type: 'org.created', orgId: makeUuid(), actorId })
				).resolves.toBeUndefined();
			});
		}

		it('stamps tokenId on an event from an API-token request', async () => {
			const tokenId = makeUuid();
			const keyed: RequestContext = {
				...ctx,
				apiScope: { tokenId, scopes: [], expiresAt: '2099-01-01T00:00:00.000Z' }
			};
			await provider.orgs.createOrg(keyed, makeOrg({ id: makeUuid(), ownerId: actorId }));

			expect(sink.ofType('org.created')[0]).toMatchObject({ actorId, tokenId });
		});

		it('system-context mutations emit with actorId="system"', async () => {
			const orgId = makeUuid();
			await provider.orgs.createOrg(SYSTEM_CONTEXT, makeOrg({ id: orgId, ownerId: actorId }));

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
		solveCount: 0,
		nextVersionNumber: 2,
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
