import * as path from 'node:path';
import type {
	IShareLinkStore,
	IDefinitionStore,
	IProjectStore,
	IEventSink,
	OrgShareLink,
	ShareLink,
	RequestContext,
	ListOptions,
	Page
} from '@selvajs/platform';
import { ProviderError, SYSTEM_CONTEXT, actorOf, NoopEventSink } from '@selvajs/platform';
import { paginate } from './pagination.js';
import { readJsonFile, withFileLock, writeJsonFile } from './fsJson.js';

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
 * Writes queue on `withFileLock`, so `tryIncrementSolveCount` checks the cap and
 * counts as one step, but only within this process: two processes sharing
 * `share-links.json` can both admit the last solve under the cap.
 */
export class LocalShareLinkStore implements IShareLinkStore {
	private definitionProvider?: IDefinitionStore;
	private projectProvider?: IProjectStore;
	private readonly events: IEventSink;
	private readonly configFilePath: string;

	// Callers must still call `setDefinitionProvider` before token resolution or
	// solve counting, or the soft-delete cascade check silently no-ops.
	// LocalDataProvider wires this when it builds the store.
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
	 * Wires the definition store so token resolution and solve counting can check
	 * the parent definition's `deletedAt`, as Supabase does in SQL. Optional: if
	 * unset, this falls back to the local-only revoke check, and the selva
	 * app's route layer does the parent lookup as a safety net either way.
	 */
	setDefinitionProvider(definitions: IDefinitionStore): void {
		this.definitionProvider = definitions;
	}

	/**
	 * Wires the project store so `listByOrg` can complete the definition→project
	 * hop that gives a link its org. Unset, the roster reads empty rather than
	 * unfiltered — a share-link list that silently spans tenants is worse than
	 * no list.
	 */
	setProjectProvider(projects: IProjectStore): void {
		this.projectProvider = projects;
	}

	private async readAll(): Promise<OnDiskShape> {
		return readJsonFile<OnDiskShape>(this.configFilePath, empty());
	}

	private async writeAll(data: OnDiskShape): Promise<void> {
		await writeJsonFile(this.configFilePath, data);
	}

	private locked<T>(fn: () => Promise<T>): Promise<T> {
		return withFileLock(this.configFilePath, fn);
	}

	// Revoked or expired counts as dead. Both providers filter both fields; a
	// link that reads live under one and dead under the other is the bug this
	// prevents.
	private isLive(l: ShareLink | undefined | null): l is ShareLink {
		if (!l || l.revokedAt != null) return false;
		return l.expiresAt == null || Date.parse(l.expiresAt) > Date.now();
	}

	async create(ctx: RequestContext, link: ShareLink): Promise<void> {
		await this.locked(async () => {
			const all = await this.readAll();
			if (all.links[link.id]) {
				throw new ProviderError(`Share link '${link.id}' already exists`, 409);
			}
			all.links[link.id] = { ...link, revokedAt: null };
			await this.writeAll(all);
		});
		await this.events.emit({
			type: 'share_link.minted',
			linkId: link.id,
			definitionId: link.definitionId,
			...actorOf(ctx)
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

	async listByOrg(
		ctx: RequestContext,
		orgId: string,
		opts?: ListOptions
	): Promise<Page<OrgShareLink>> {
		// No org column on a link — the org is two hops up, through the parent
		// definition to its project. Supabase does this as a SQL join; here it is
		// a lookup, same as the soft-delete cascade in `getByTokenHash`.
		if (!this.definitionProvider || !this.projectProvider) return paginate([], opts);

		const all = await this.readAll();
		const live = Object.values(all.links).filter((l) => this.isLive(l));
		if (live.length === 0) return paginate([], opts);

		const definitions = new Map(
			await Promise.all(
				[...new Set(live.map((l) => l.definitionId))].map(
					async (id) => [id, await this.definitionProvider!.get(SYSTEM_CONTEXT, id)] as const
				)
			)
		);

		// One page covers any realistic org; the roster is a per-tenant view.
		const projects = await this.projectProvider.listProjects(ctx, orgId, { limit: 1000 });
		const projectById = new Map(projects.items.map((p) => [p.id, p]));

		const rows: OrgShareLink[] = [];
		for (const link of live) {
			const definition = definitions.get(link.definitionId);
			// A link whose definition is soft-deleted is unresolvable, so listing it
			// would offer a revoke that changes nothing.
			if (!definition) continue;
			const project = projectById.get(definition.projectId);
			if (!project) continue;
			const { tokenHash: _tokenHash, ...rest } = link;
			rows.push({
				...rest,
				definitionName: definition.displayName,
				projectId: project.id,
				projectName: project.name
			});
		}
		rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
		return (await this.parentIsLive(found)) ? found : null;
	}

	// Token resolution and solve counting must not see links whose parent
	// definition is soft-deleted — Supabase enforces this in SQL, here via lookup.
	private async parentIsLive(link: ShareLink): Promise<boolean> {
		if (!this.definitionProvider) return true;
		return (await this.definitionProvider.get(SYSTEM_CONTEXT, link.definitionId)) !== null;
	}

	async revoke(ctx: RequestContext, id: string): Promise<void> {
		const revoked = await this.locked(async () => {
			const all = await this.readAll();
			const l = all.links[id];
			if (!l) throw new ProviderError(`Share link '${id}' not found`, 404);
			if (!this.isLive(l)) return false; // idempotent
			l.revokedAt = new Date().toISOString();
			await this.writeAll(all);
			return true;
		});
		if (!revoked) return;
		await this.events.emit({ type: 'share_link.revoked', linkId: id, ...actorOf(ctx) });
	}

	async tryIncrementSolveCount(_ctx: RequestContext, id: string): Promise<number | null> {
		return this.locked(async () => {
			const all = await this.readAll();
			const l = all.links[id];
			if (!l || !this.isLive(l)) return null;
			if (l.maxSolves != null && l.solveCount >= l.maxSolves) return null;
			if (!(await this.parentIsLive(l))) return null;
			l.solveCount += 1;
			await this.writeAll(all);
			return l.solveCount;
		});
	}

	/** A link goes with the user who minted it, as Supabase's `created_by` cascade does. */
	async eraseUser(userId: string): Promise<void> {
		await this.locked(async () => {
			const all = await this.readAll();
			for (const [id, link] of Object.entries(all.links)) {
				if (link.createdBy === userId) delete all.links[id];
			}
			await this.writeAll(all);
		});
	}
}
