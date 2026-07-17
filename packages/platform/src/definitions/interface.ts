import type { RequestContext } from '../context.js';
import type { ListOptions, DefinitionListOptions, Page } from '../pagination.js';
import type { UISchema } from '@selvajs/schemas';
import type { DefinitionRecord, DefinitionRecordPatch, DefinitionVersion } from './types.js';

/**
 * Definition metadata + version store. Blob contents live in `IStorageProvider`;
 * this interface tracks the parent record plus immutable version rows and the
 * `live` / `draft` channel pointers.
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
	 * List definitions whose parent project has `visibility === 'public'`.
	 * Pass `orgId` to restrict to one org; omit for cross-org listing within
	 * whatever tenant boundary the adapter already enforces.
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
	 * Cascade hook: soft-delete every live definition in a project. Called by
	 * `IProjectStore.deleteProject` — a deleted project must never keep serving
	 * its definitions (they surface in the library/public listings independent
	 * of the project row). No-op when the project has none. Mirrors the
	 * `deleteByProject` cascade hooks on `IPlatformProjectGrantStore`.
	 */
	deleteByProject(ctx: RequestContext, projectId: string): Promise<void>;

	/** Atomic +1 on the solve counter. No-op if the record doesn't exist. */
	incrementSolveCount(ctx: RequestContext, guid: string): Promise<void>;

	/**
	 * Atomically reserve the next `versionNumber` for a new version: returns the
	 * current `nextVersionNumber` and advances the counter by 1 in a single
	 * operation (so concurrent uploads never collide on a number/fileKey). The
	 * counter is monotonic and NEVER decremented — deleting the latest version
	 * does not free its number, so a delete-then-reupload mints a fresh number and
	 * fresh `fileKey` instead of overwriting the deleted blob's key. Throws if the
	 * definition doesn't exist.
	 */
	reserveNextVersionNumber(ctx: RequestContext, guid: string): Promise<number>;

	// Versions (immutable rows)
	createVersion(ctx: RequestContext, version: DefinitionVersion): Promise<void>;
	/**
	 * Newest first by `versionNumber`. Listed rows carry metadata only — `schema`
	 * is always `undefined` here regardless of what is stored, because it is a
	 * large blob no list caller needs. Use `getVersion` when you need the schema.
	 */
	listVersions(
		ctx: RequestContext,
		definitionId: string,
		opts?: ListOptions
	): Promise<Page<DefinitionVersion>>;
	/** The full row, including the cached `schema` when one has been extracted. */
	getVersion(ctx: RequestContext, versionId: string): Promise<DefinitionVersion | null>;

	/**
	 * Set the cached compute-extracted schema on a version row. Used by the
	 * upload path (writes the schema validated up-front) and the temporary
	 * solve-time backfill bridge (see selva/specs/SchemaCaching.md). No-op if
	 * the version doesn't exist.
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
	 * single update — used by the create flow so a mid-flight failure can't
	 * leave the record half-promoted (status='draft' with a null channel
	 * pointer, or status='pending' with channels set).
	 *
	 * Validates that `versionId` belongs to `definitionId` (404 if not).
	 *
	 * Does NOT emit `definition.published`. The bootstrap is covered by the
	 * parent's `definition.created` + `definition_version.created` pair;
	 * `definition.published` is reserved for explicit publish ops via
	 * `setLiveVersion`.
	 */
	attachInitialVersion(ctx: RequestContext, definitionId: string, versionId: string): Promise<void>;
}
