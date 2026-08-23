import type { RequestContext } from '../context.js';
import type { ListOptions, DefinitionListOptions, Page } from '../pagination.js';
import type { UISchema } from '@selvajs/schemas';
import type { DefinitionRecord, DefinitionRecordPatch, DefinitionVersion } from './types.js';

/**
 * Definition metadata + version store. Blob contents live in `IStorageProvider`;
 * this tracks the parent record, immutable version rows, and the `live`/`draft`
 * channel pointers.
 */
export interface IDefinitionStore {
	// Definitions
	list(ctx: RequestContext, opts?: DefinitionListOptions): Promise<Page<DefinitionRecord>>;
	listByProject(
		ctx: RequestContext,
		projectId: string,
		opts?: DefinitionListOptions
	): Promise<Page<DefinitionRecord>>;
	/**
	 * Lists definitions whose parent project has `visibility === 'public'`.
	 * Pass `orgId` to restrict to one org; omit for cross-org listing.
	 */
	listPublic(
		ctx: RequestContext,
		opts?: DefinitionListOptions & { orgId?: string }
	): Promise<Page<DefinitionRecord>>;
	get(ctx: RequestContext, guid: string): Promise<DefinitionRecord | null>;
	create(ctx: RequestContext, record: DefinitionRecord): Promise<void>;
	update(ctx: RequestContext, guid: string, patch: DefinitionRecordPatch): Promise<void>;
	delete(ctx: RequestContext, guid: string): Promise<void>;

	/**
	 * Cascade hook: soft-deletes every live definition in a project. Called by
	 * `IProjectStore.deleteProject` — definitions surface in library/public
	 * listings independent of the project row, so a deleted project must not
	 * keep serving them. No-op when the project has none.
	 */
	deleteByProject(ctx: RequestContext, projectId: string): Promise<void>;

	/** Atomic +1 on the solve counter. No-op if the record doesn't exist. */
	incrementSolveCount(ctx: RequestContext, guid: string): Promise<void>;

	/**
	 * Atomically returns the current `nextVersionNumber` and advances the counter
	 * by 1, so concurrent uploads never collide on a number/fileKey. Never
	 * decremented — deleting the latest version doesn't free its number, so a
	 * delete-then-reupload mints a fresh `fileKey` instead of reusing the deleted
	 * blob's key. Throws if the definition doesn't exist.
	 */
	reserveNextVersionNumber(ctx: RequestContext, guid: string): Promise<number>;

	// Versions (immutable rows)
	createVersion(ctx: RequestContext, version: DefinitionVersion): Promise<void>;
	/**
	 * Newest first by `versionNumber`. `schema` is always `undefined` on listed
	 * rows regardless of what's stored — it's a large blob no list caller needs.
	 * Use `getVersion` for the schema.
	 */
	listVersions(
		ctx: RequestContext,
		definitionId: string,
		opts?: ListOptions
	): Promise<Page<DefinitionVersion>>;
	/** The full row, including the cached `schema` when one has been extracted. */
	getVersion(ctx: RequestContext, versionId: string): Promise<DefinitionVersion | null>;

	/**
	 * Sets the cached compute-extracted schema on a version row. Used by the
	 * upload path and the solve-time backfill bridge for pre-existing versions.
	 * No-op if the version doesn't exist.
	 */
	setVersionSchema(ctx: RequestContext, versionId: string, schema: UISchema): Promise<void>;
	/**
	 * Throws 409 if the version is referenced by `liveVersionId` or
	 * `draftVersionId`. Caller deletes the blob separately.
	 */
	deleteVersion(ctx: RequestContext, versionId: string): Promise<void>;

	/** Atomically point `liveVersionId` at a target version of this definition. */
	setLiveVersion(ctx: RequestContext, definitionId: string, versionId: string): Promise<void>;
	setDraftVersion(ctx: RequestContext, definitionId: string, versionId: string): Promise<void>;

	/**
	 * Atomic `'pending'` → `'draft'` bootstrap. Sets BOTH `liveVersionId` and
	 * `draftVersionId` to `versionId` and flips `status` to `'draft'` in a
	 * single update, so a mid-flight failure can't leave the record
	 * half-promoted (draft status with a null channel pointer, or pending
	 * status with channels set).
	 *
	 * Validates that `versionId` belongs to `definitionId` (404 if not).
	 *
	 * Does NOT emit `definition.published` — that event is reserved for
	 * explicit publish via `setLiveVersion`.
	 */
	attachInitialVersion(ctx: RequestContext, definitionId: string, versionId: string): Promise<void>;
}
