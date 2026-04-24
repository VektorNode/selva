import type { IDataProvider } from '../data/interface.js';
import type { IStorageProvider } from '../storage/interface.js';
import type { RequestContext } from '../context.js';
import { SYSTEM_CONTEXT } from '../context.js';
import { ProviderError } from '../errors.js';
import type { DefinitionRecord, DefinitionFileExt } from './types.js';
import { definitionPaths } from './paths.js';
import type { UpdateMetadataInput } from './schemas.js';

export interface CreateDefinitionInput {
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
	maxHistory?: number;
}

/**
 * Default age threshold after which a 'pending' record is considered stale.
 * Conservative — covers slow uploads over weak connections.
 */
export const PENDING_GC_AGE_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Orchestrates writes that span IDataProvider + IStorageProvider.
 *
 * Ordering rules (see Phase 4 of the provider refactor):
 *
 *   create — metadata-first:
 *     1. Write record with status='pending'
 *     2. Upload blob
 *     3. Flip status to 'ready'
 *   If step 2 fails the record stays 'pending' with no blob. List queries
 *   filter 'pending' by default, so no consumer sees the half-written state.
 *   The janitor (gcStalePending) sweeps records older than PENDING_GC_AGE_MS.
 *
 *   updateFile — best-effort with retry-safe shape:
 *     1. Archive current file to history blob
 *     2. Append history entry to record
 *     3. Write new file to the active blob path
 *     4. Prune history beyond maxHistory
 *   A failure between 2 and 3 leaves the record pointing at a missing active
 *   blob. The operation is idempotent — retrying with the same file restores
 *   a consistent state. This is an acknowledged limitation; the create path
 *   is where orphan risk is highest and is the one we fully guard.
 */
export class DefinitionService {
	constructor(
		private data: IDataProvider,
		private storage: IStorageProvider
	) {}

	async create(
		ctx: RequestContext,
		input: CreateDefinitionInput,
		file: Uint8Array
	): Promise<DefinitionRecord> {
		const now = new Date().toISOString();
		const record: DefinitionRecord = {
			guid: input.guid,
			projectId: input.projectId,
			ownerId: input.ownerId,
			fileExt: input.fileExt,
			originalFilename: input.originalFilename,
			displayName: input.displayName,
			description: input.description,
			category: input.category,
			tags: input.tags,
			coverImage: input.coverImage,
			computeServerId: input.computeServerId,
			history: [],
			maxHistory: input.maxHistory ?? 10,
			status: 'pending',
			runCount: 0,
			createdAt: now,
			updatedAt: now
		};

		// 1. Metadata first — if this fails there's nothing to clean up.
		await this.data.definitions.create(ctx, record);

		// 2. Blob upload — if this fails the record stays 'pending' for the janitor.
		await this.storage.put(
			definitionPaths.file(input.guid, input.fileExt),
			file,
			'application/octet-stream'
		);

		// 3. Flip to draft — the record is now visible to editors.
		await this.data.definitions.update(ctx, input.guid, { status: 'draft' });

		return { ...record, status: 'draft' };
	}

	async updateFile(
		ctx: RequestContext,
		guid: string,
		file: Uint8Array,
		ext: DefinitionFileExt,
		originalName: string
	): Promise<void> {
		const existing = await this.data.definitions.get(ctx, guid);
		if (!existing) throw new ProviderError(`Definition not found: ${guid}`, 404);

		const now = new Date().toISOString();
		// UUID-based ref avoids collisions from identical timestamps or special chars in filenames.
		const ref = `${crypto.randomUUID()}_${originalName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

		// Archive the current file before overwriting
		const currentFile = await this.storage.get(definitionPaths.file(guid, existing.fileExt));
		if (currentFile) {
			await this.storage.put(
				definitionPaths.archive(guid, ref),
				currentFile,
				'application/octet-stream'
			);
			await this.data.definitions.addHistoryEntry(ctx, guid, {
				ref,
				originalName,
				archivedAt: now
			});
		}

		await this.storage.put(definitionPaths.file(guid, ext), file, 'application/octet-stream');
		if (ext !== existing.fileExt) {
			await this.storage.delete(definitionPaths.file(guid, existing.fileExt));
		}
		await this.data.definitions.update(ctx, guid, { fileExt: ext, originalFilename: originalName });

		// Prune history if maxHistory is set
		const updated = await this.data.definitions.get(ctx, guid);
		if (updated && updated.maxHistory > 0 && updated.history.length > updated.maxHistory) {
			const toRemove = updated.history.slice(updated.maxHistory);
			for (const entry of toRemove) {
				await this.storage.delete(definitionPaths.archive(guid, entry.ref));
				await this.data.definitions.removeHistoryEntry(ctx, guid, entry.ref);
			}
		}
	}

	async updateMeta(ctx: RequestContext, guid: string, patch: UpdateMetadataInput): Promise<void> {
		await this.data.definitions.update(ctx, guid, patch);
	}

	async saveCoverImage(ctx: RequestContext, guid: string, imageData: Uint8Array): Promise<void> {
		const path = definitionPaths.image(guid);
		await this.storage.put(path, imageData, 'image/webp');
		const url = this.storage.getPublicUrl(path);
		await this.data.definitions.update(ctx, guid, { coverImage: url });
	}

	async revertToVersion(ctx: RequestContext, guid: string, ref: string): Promise<void> {
		const existing = await this.data.definitions.get(ctx, guid);
		if (!existing) throw new ProviderError(`Definition not found: ${guid}`, 404);

		const entry = existing.history.find((h) => h.ref === ref);
		if (!entry) throw new ProviderError(`History entry not found: ${ref}`, 404);

		const archived = await this.storage.get(definitionPaths.archive(guid, ref));
		if (!archived) throw new ProviderError(`Archived file not found for ref: ${ref}`, 404);

		// Archive the current file first, then restore the old one
		await this.updateFile(ctx, guid, archived, existing.fileExt, entry.originalName);
	}

	async delete(ctx: RequestContext, guid: string): Promise<void> {
		// Blobs first — if this fails, record remains and retry is safe.
		// If record delete fails after, the record points at nothing; the
		// next get() returns null-payload semantics and the janitor cleans up.
		await this.storage.deletePrefix(definitionPaths.prefix(guid));
		await this.data.definitions.delete(ctx, guid);
	}

	/**
	 * Janitor — delete records stuck in 'pending' for longer than ageMs and
	 * any blobs they may have written. Safe to run on a schedule.
	 * Runs under SYSTEM_CONTEXT; callers don't pass one.
	 *
	 * @returns Number of records reclaimed.
	 */
	async gcStalePending(ageMs: number = PENDING_GC_AGE_MS): Promise<number> {
		const cutoff = new Date(Date.now() - ageMs).toISOString();
		const stale = await this.data.definitions.listStalePending(SYSTEM_CONTEXT, cutoff);
		for (const record of stale) {
			await this.storage.deletePrefix(definitionPaths.prefix(record.guid));
			await this.data.definitions.delete(SYSTEM_CONTEXT, record.guid);
		}
		return stale.length;
	}
}
