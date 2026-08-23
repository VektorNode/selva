import { randomUUID } from 'node:crypto';
import type {
	IDataProvider,
	IStorageProvider,
	RequestContext,
	DefinitionRecord,
	DefinitionFileExt,
	DefinitionVersion,
	UpdateMetadataInput,
	UISchema
} from '@selvajs/platform';
import { ProviderError, definitionPaths } from '@selvajs/platform';

/**
 * Not the HTTP body — that's `CreateDefinitionInputSchema` in
 * `@selvajs/platform/definitions`, which has no guid/ownerId because those are
 * derived server-side.
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
 * Orchestrates writes spanning IDataProvider + IStorageProvider. Application
 * orchestration, not platform contract — hence not in @selvajs/platform.
 *
 * Methods that write both metadata and blobs order the two so a mid-flight
 * failure leaves a state the API can still serve; those reasons sit inline at
 * each write. `publish` and `updateMeta` flip pointers/metadata only and touch
 * storage not at all.
 */
export class DefinitionService {
	constructor(
		private data: IDataProvider,
		private storage: IStorageProvider
	) {}

	async create(
		ctx: RequestContext,
		input: CreateDefinitionRecord,
		file: Uint8Array,
		schema: UISchema
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
			solveCount: 0,
			// v1 is created below with versionNumber 1, so the next upload reserves 2.
			nextVersionNumber: 2,
			liveVersionId: null,
			draftVersionId: null,
			createdAt: now,
			updatedAt: now,
			deletedAt: null
		};

		// Metadata first — if this fails there's nothing to clean up.
		await this.data.definitions.create(ctx, record);

		// If the blob write fails, the record stays 'pending' and is hidden from
		// default list queries.
		const versionId = randomUUID();
		const fileKey = definitionPaths.version(input.guid, 1, input.fileExt);
		await this.storage.put(fileKey, file, 'application/octet-stream');

		const version: DefinitionVersion = {
			id: versionId,
			definitionId: input.guid,
			versionNumber: 1,
			fileExt: input.fileExt,
			fileKey,
			originalFilename: input.originalFilename,
			uploadedBy: actor,
			uploadedAt: now,
			schema,
			schemaExtractedAt: now
		};
		await this.data.definitions.createVersion(ctx, version);

		// Points both channels at v1 and flips status='draft' in ONE store
		// operation. Doing it as three writes leaves a partial state on failure:
		// status='draft' with null pointers, or 'pending' with pointers set.
		await this.data.definitions.attachInitialVersion(ctx, input.guid, versionId);

		return {
			record: { ...record, status: 'draft', liveVersionId: versionId, draftVersionId: versionId },
			version
		};
	}

	/**
	 * Advances the draft pointer only — `live` is unchanged. Use `publish` to
	 * promote.
	 */
	async uploadVersion(
		ctx: RequestContext,
		guid: string,
		file: Uint8Array,
		ext: DefinitionFileExt,
		originalName: string,
		schema: UISchema,
		changeNote?: string
	): Promise<DefinitionVersion> {
		const existing = await this.data.definitions.get(ctx, guid);
		if (!existing) throw new ProviderError(`Definition not found: ${guid}`, 404);

		// Monotonic counter, NOT max(existing)+1 — the latter reuses a number after
		// delete-latest and collides the `fileKey`, serving a stale blob for new
		// content.
		const next = await this.data.definitions.reserveNextVersionNumber(ctx, guid);

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
			changeNote: changeNote?.trim() || undefined,
			schema,
			schemaExtractedAt: now
		};
		await this.data.definitions.createVersion(ctx, version);
		await this.data.definitions.setDraftVersion(ctx, guid, versionId);

		return version;
	}

	/**
	 * Moves the live channel to `versionId`, or to the current draft if omitted.
	 * Any version id is accepted, so this rolls backward as well as forward.
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
		// Metadata is soft-deleted (audit trail, restorable by clearing
		// `deleted_at`); blobs are HARD-deleted.
		//
		// Metadata first, so the API hides the record immediately. A failed blob
		// wipe then leaves orphan storage that no reader can reach, for a
		// retention sweep to collect. The reverse order leaves the record alive
		// with its blobs gone — a 404 for any in-flight reader.
		await this.data.definitions.delete(ctx, guid);
		await this.storage.deletePrefix(definitionPaths.prefix(guid));
	}
}
