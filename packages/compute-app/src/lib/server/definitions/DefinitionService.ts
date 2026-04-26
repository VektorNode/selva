import { randomUUID } from 'node:crypto';
import type {
	IDataProvider,
	IStorageProvider,
	RequestContext,
	DefinitionRecord,
	DefinitionFileExt,
	DefinitionVersion,
	UpdateMetadataInput
} from '@selva/platform';
import { ProviderError, definitionPaths } from '@selva/platform';

/**
 * Input passed to `DefinitionService.create`. Carries everything the service
 * needs to assemble a `DefinitionRecord` plus orchestrate the v1 upload.
 *
 * Distinct from `CreateDefinitionInputSchema` exported by
 * `@selva/platform/definitions/schemas`, which validates the user-facing
 * HTTP body (no guid/ownerId — those are derived server-side).
 */
export interface CreateDefinitionRecord {
	guid: string;
	projectId: string;
	ownerId: string;
	fileExt: DefinitionFileExt;
	originalFilename?: string;
	displayName: string;
	description?: string;
	category?: string;
	tags?: string[];
	coverImage?: string;
	computeServerId?: string;
}

/**
 * Default age threshold after which a 'pending' record is considered stale.
 * Conservative — covers slow uploads over weak connections.
 */

/**
 * Orchestrates writes that span IDataProvider + IStorageProvider for the
 * spec §6 versioning model. Lives in compute-app (not @selva/platform)
 * because it is application orchestration, not platform contract.
 *
 * Ordering rules:
 *
 *   create — metadata-first, then v1:
 *     1. Write record with status='pending', both pointers null
 *     2. Upload v1 blob to versions/v1.{ext}
 *     3. Insert DefinitionVersion row v1
 *     4. `attachInitialVersion` — atomically set live + draft pointers and
 *        flip status to 'draft' in a single store operation.
 *   Step 4 is one round-trip so a mid-flight failure can't leave a partial
 *   state (status='draft' with null pointers, or status='pending' with
 *   pointers set). If step 2 fails the record stays 'pending' with no
 *   blob; the janitor sweeps stale pendings.
 *
 *   uploadVersion — append-only:
 *     1. Resolve next versionNumber from the version list
 *     2. Upload blob to versions/v{N}.{ext}
 *     3. Insert DefinitionVersion row
 *     4. Advance draft pointer (live unchanged)
 *
 *   publish — pointer flip only, no blob writes.
 *
 *   deleteVersion — store enforces "not referenced by live/draft"; on
 *   success, delete the underlying blob.
 */
export class DefinitionService {
	constructor(
		private data: IDataProvider,
		private storage: IStorageProvider
	) {}

	async create(
		ctx: RequestContext,
		input: CreateDefinitionRecord,
		file: Uint8Array
	): Promise<{ record: DefinitionRecord; version: DefinitionVersion }> {
		const now = new Date().toISOString();
		const actor = ctx.userId || input.ownerId;
		const record: DefinitionRecord = {
			guid: input.guid,
			projectId: input.projectId,
			ownerId: input.ownerId,
			createdBy: actor,
			updatedBy: actor,
			displayName: input.displayName,
			description: input.description,
			category: input.category,
			tags: input.tags,
			coverImage: input.coverImage,
			computeServerId: input.computeServerId,
			status: 'pending',
			runCount: 0,
			liveVersionId: null,
			draftVersionId: null,
			createdAt: now,
			updatedAt: now,
			deletedAt: null
		};

		// 1. Metadata first — if this fails there's nothing to clean up.
		await this.data.definitions.create(ctx, record);

		// 2. v1 blob — if this fails the record stays 'pending' for the janitor.
		const versionId = randomUUID();
		const fileKey = definitionPaths.version(input.guid, 1, input.fileExt);
		await this.storage.put(fileKey, file, 'application/octet-stream');

		// 3. Version row.
		const version: DefinitionVersion = {
			id: versionId,
			definitionId: input.guid,
			versionNumber: 1,
			fileExt: input.fileExt,
			fileKey,
			originalFilename: input.originalFilename,
			uploadedBy: actor,
			uploadedAt: now
		};
		await this.data.definitions.createVersion(ctx, version);

		// 4. Atomically point both channels at v1 and flip status='draft' in a
		//    single store operation. Replaces three separate writes
		//    (setLiveVersion + setDraftVersion + update) — see the class
		//    header for why ordering matters here.
		await this.data.definitions.attachInitialVersion(ctx, input.guid, versionId);

		return {
			record: { ...record, status: 'draft', liveVersionId: versionId, draftVersionId: versionId },
			version
		};
	}

	/**
	 * Upload a new version of an existing definition. Writes the blob, inserts
	 * the version row, and advances the draft pointer. `live` is unchanged —
	 * use `publish` to promote.
	 */
	async uploadVersion(
		ctx: RequestContext,
		guid: string,
		file: Uint8Array,
		ext: DefinitionFileExt,
		originalName: string,
		changeNote?: string
	): Promise<DefinitionVersion> {
		const existing = await this.data.definitions.get(ctx, guid);
		if (!existing) throw new ProviderError(`Definition not found: ${guid}`, 404);

		// Highest existing versionNumber + 1; covers gaps from deletions.
		const versions = await this.data.definitions.listVersions(ctx, guid, { limit: 1 });
		const next = (versions.items[0]?.versionNumber ?? 0) + 1;

		const versionId = randomUUID();
		const fileKey = definitionPaths.version(guid, next, ext);
		await this.storage.put(fileKey, file, 'application/octet-stream');

		const now = new Date().toISOString();
		const actor = ctx.userId || existing.ownerId;
		const version: DefinitionVersion = {
			id: versionId,
			definitionId: guid,
			versionNumber: next,
			fileExt: ext,
			fileKey,
			originalFilename: originalName,
			uploadedBy: actor,
			uploadedAt: now,
			changeNote: changeNote?.trim() || undefined
		};
		await this.data.definitions.createVersion(ctx, version);
		await this.data.definitions.setDraftVersion(ctx, guid, versionId);

		return version;
	}

	/**
	 * Advance the live channel. If `versionId` is omitted, promotes the
	 * current draft. Pass an arbitrary version id to roll forward/back —
	 * spec §6 makes rollback a first-class operation.
	 */
	async publish(ctx: RequestContext, guid: string, versionId?: string): Promise<DefinitionVersion> {
		const existing = await this.data.definitions.get(ctx, guid);
		if (!existing) throw new ProviderError(`Definition not found: ${guid}`, 404);

		const target = versionId ?? existing.draftVersionId;
		if (!target) throw new ProviderError('No version to publish', 400);

		const version = await this.data.definitions.getVersion(ctx, target);
		if (!version || version.definitionId !== guid) {
			throw new ProviderError(`Version '${target}' not found for this definition`, 404);
		}

		await this.data.definitions.setLiveVersion(ctx, guid, target);
		// Flip status to 'published' the first time live moves off pending/draft.
		if (existing.status === 'draft' || existing.status === 'pending') {
			await this.data.definitions.update(ctx, guid, { status: 'published' });
		}
		return version;
	}

	async deleteVersion(ctx: RequestContext, guid: string, versionId: string): Promise<void> {
		const version = await this.data.definitions.getVersion(ctx, versionId);
		if (!version || version.definitionId !== guid) {
			throw new ProviderError(`Version '${versionId}' not found for this definition`, 404);
		}
		// Store enforces the live/draft reference check; if it throws, blob stays.
		await this.data.definitions.deleteVersion(ctx, versionId);
		await this.storage.delete(version.fileKey);
	}

	async updateMeta(ctx: RequestContext, guid: string, patch: UpdateMetadataInput): Promise<void> {
		await this.data.definitions.update(ctx, guid, patch);
	}

	async saveCoverImage(ctx: RequestContext, guid: string, imageData: Uint8Array): Promise<string> {
		const path = definitionPaths.image(guid);
		await this.storage.put(path, imageData, 'image/webp');
		const url = this.storage.getPublicUrl(path);
		await this.data.definitions.update(ctx, guid, { coverImage: url });
		return url;
	}

	async delete(ctx: RequestContext, guid: string): Promise<void> {
		// CONTRACT (spec §9): metadata is soft-deleted (preserved for audit,
		// restorable by clearing `deleted_at`); blobs are HARD-deleted. The
		// record is the audit trail; the blobs are storage cost.
		//
		// Order matters. Metadata first so the API immediately hides the
		// record (RLS / `deleted_at IS NULL` filter). If the blob wipe then
		// fails, the orphan storage is unreachable through the API — a
		// retention sweep can clean it up later. The reverse order leaves a
		// window where the record is still alive but its blobs are gone — a
		// 404 source for any in-flight reader.
		await this.data.definitions.delete(ctx, guid);
		await this.storage.deletePrefix(definitionPaths.prefix(guid));
	}
}
