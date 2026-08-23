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
 * `tryIncrementSolveCount` is race-sensitive: this store does a plain
 * read-modify-write, fine at single-node scale. Postgres adapters use a true
 * atomic UPDATE instead.
 */
export class LocalShareLinkStore implements IShareLinkStore {
	private definitionProvider?: IDefinitionStore;
	private projectProvider?: IProjectStore;
	private readonly events: IEventSink;
	private readonly configFilePath: string;

	// Callers must still call `setDefinitionProvider` before token resolution,
	// or the soft-delete cascade check silently no-ops. LocalDataProvider wires
	// this when it builds the store.
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
	 * Wires the definition store so token resolution can check the parent
	 * definition's `deletedAt`, mirroring the JOIN Supabase does. Optional: if
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

	// Revoked or expired counts as dead. Both providers filter both fields; a
	// link that reads live under one and dead under the other is the bug this
	// prevents.
	private isLive(l: ShareLink | undefined | null): l is ShareLink {
		if (!l || l.revokedAt != null) return false;
		return l.expiresAt == null || Date.parse(l.expiresAt) > Date.now();
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
		// Token resolution must not see links whose parent definition is
		// soft-deleted — Supabase enforces this via JOIN, here via lookup.
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
