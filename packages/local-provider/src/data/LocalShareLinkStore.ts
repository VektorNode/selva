import * as path from 'node:path';
import type {
	IShareLinkStore,
	IDefinitionStore,
	IEventSink,
	ShareLink,
	RequestContext,
	ListOptions,
	Page
} from '@selvajs/platform';
import { ProviderError, SYSTEM_CONTEXT, actorFrom, NoopEventSink } from '@selvajs/platform';
import { paginate } from './pagination.js';
import { readJsonFile, writeJsonFile } from './fsJson.js';

interface OnDiskShape {
	links: Record<string, ShareLink>;
}

const empty = (): OnDiskShape => ({ links: {} });

export interface LocalShareLinkStoreOptions {
	/** Absolute path to the JSON file backing this store. */
	filePath: string;
	events?: IEventSink;
}

/**
 * Spec §7 — share-link store backed by share-links.json.
 *
 * `tryIncrementSolveCount` is the load-bearing race-sensitive method; in
 * the local provider we read-modify-write under a single fs round-trip,
 * which is acceptable at single-node scale. Postgres adapters use a true
 * atomic UPDATE.
 */
export class LocalShareLinkStore implements IShareLinkStore {
	private definitionProvider?: IDefinitionStore;
	private readonly events: IEventSink;
	private readonly configFilePath: string;

	static fromEnv(env: Record<string, string | undefined>): LocalShareLinkStore {
		if (!env.DATA_PATH) throw new Error('Missing required env var: DATA_PATH');
		return new LocalShareLinkStore({
			filePath: path.join(env.DATA_PATH, 'share-links.json')
		});
	}

	constructor(opts: LocalShareLinkStoreOptions) {
		this.configFilePath = opts.filePath;
		this.events = opts.events ?? new NoopEventSink();
	}

	/**
	 * Wire the definition store so token resolution can check the parent
	 * definition's `deletedAt` (Permissions.md §7 cascade contract). Mirrors
	 * Supabase, which performs the equivalent JOIN. Optional: when unset, the
	 * store falls back to the local-only revoke check; the route layer in
	 * compute-app does the parent lookup as a safety net either way.
	 */
	setDefinitionProvider(definitions: IDefinitionStore): void {
		this.definitionProvider = definitions;
	}

	private async readAll(): Promise<OnDiskShape> {
		return readJsonFile<OnDiskShape>(this.configFilePath, empty());
	}

	private async writeAll(data: OnDiskShape): Promise<void> {
		await writeJsonFile(this.configFilePath, data);
	}

	private isLive(l: ShareLink | undefined | null): l is ShareLink {
		return Boolean(l && l.revokedAt == null);
	}

	async create(ctx: RequestContext, link: ShareLink): Promise<void> {
		const all = await this.readAll();
		if (all.links[link.id]) {
			throw new ProviderError(`Share link '${link.id}' already exists`, 409);
		}
		all.links[link.id] = { ...link, revokedAt: null };
		await this.writeAll(all);
		await this.events.emit({
			type: 'share_link.minted',
			linkId: link.id,
			definitionId: link.definitionId,
			actorId: actorFrom(ctx)
		});
	}

	async listByDefinition(
		_ctx: RequestContext,
		definitionId: string,
		opts?: ListOptions
	): Promise<Page<ShareLink>> {
		const all = await this.readAll();
		const rows = Object.values(all.links)
			.filter((l) => l.definitionId === definitionId && this.isLive(l))
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
		return paginate(rows, opts);
	}

	async getById(_ctx: RequestContext, id: string): Promise<ShareLink | null> {
		const all = await this.readAll();
		return all.links[id] ?? null;
	}

	async getByTokenHash(_ctx: RequestContext, tokenHash: string): Promise<ShareLink | null> {
		const all = await this.readAll();
		const found = Object.values(all.links).find((l) => l.tokenHash === tokenHash);
		if (!this.isLive(found)) return null;
		// §7: token resolution MUST NOT see links whose parent definition is
		// soft-deleted. Supabase enforces this via JOIN; here we look up.
		if (this.definitionProvider) {
			const parent = await this.definitionProvider.get(SYSTEM_CONTEXT, found.definitionId);
			if (!parent) return null;
		}
		return found;
	}

	async revoke(ctx: RequestContext, id: string): Promise<void> {
		const all = await this.readAll();
		const l = all.links[id];
		if (!l || !this.isLive(l)) return; // idempotent
		l.revokedAt = new Date().toISOString();
		await this.writeAll(all);
		await this.events.emit({ type: 'share_link.revoked', linkId: id, actorId: actorFrom(ctx) });
	}

	async tryIncrementSolveCount(_ctx: RequestContext, id: string): Promise<number | null> {
		const all = await this.readAll();
		const l = all.links[id];
		if (!l || !this.isLive(l)) return null;
		if (l.maxSolves != null && l.solveCount >= l.maxSolves) return null;
		l.solveCount += 1;
		await this.writeAll(all);
		return l.solveCount;
	}
}
