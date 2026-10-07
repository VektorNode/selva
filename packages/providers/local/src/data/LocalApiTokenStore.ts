import * as path from 'node:path';
import type {
	ApiToken,
	ApiTokenRevokeReason,
	ApiTokenSummary,
	IApiTokenStore,
	IEventSink,
	ListOptions,
	Page,
	RequestContext
} from '@selvajs/platform';
import { NoopEventSink, actorOf } from '@selvajs/platform';
import { paginate, applyOrder } from './pagination.js';
import { readJsonFile, writeJsonFile } from './fsJson.js';

interface ApiTokensFile {
	tokens: ApiToken[];
}
// Factory, not a shared constant: `readJsonFile` returns the fallback by
// reference and `create` pushes into it.
const empty = (): ApiTokensFile => ({ tokens: [] });

function isLive(t: ApiToken, now: number): boolean {
	return t.revokedAt === null && Date.parse(t.expiresAt) > now;
}

function summarize({ tokenHash: _hash, ...rest }: ApiToken): ApiTokenSummary {
	return rest;
}

/** No per-call scoping by ctx: the route layer gates who may mint, list and revoke. */
export class LocalApiTokenStore implements IApiTokenStore {
	private readonly filePath: string;

	static fromEnv(
		env: Record<string, string | undefined>,
		events: IEventSink = new NoopEventSink()
	): LocalApiTokenStore {
		if (!env.DATA_PATH) throw new Error('Missing required env var: DATA_PATH');
		return new LocalApiTokenStore(env.DATA_PATH, events);
	}

	constructor(
		dataPath: string,
		private readonly events: IEventSink = new NoopEventSink()
	) {
		this.filePath = path.join(dataPath, 'api-tokens.json');
	}

	private load(): Promise<ApiTokensFile> {
		return readJsonFile<ApiTokensFile>(this.filePath, empty());
	}

	private save(file: ApiTokensFile): Promise<void> {
		return writeJsonFile(this.filePath, file);
	}

	async create(ctx: RequestContext, token: ApiToken): Promise<void> {
		const file = await this.load();
		file.tokens.push(token);
		await this.save(file);
		await this.events.emit({
			type: 'api_token.created',
			apiTokenId: token.id,
			orgId: token.orgId,
			userId: token.userId,
			...actorOf(ctx)
		});
	}

	async getByTokenHash(_ctx: RequestContext, tokenHash: string): Promise<ApiToken | null> {
		const { tokens } = await this.load();
		const token = tokens.find((t) => t.tokenHash === tokenHash);
		return token && isLive(token, Date.now()) ? token : null;
	}

	async get(_ctx: RequestContext, id: string): Promise<ApiTokenSummary | null> {
		const { tokens } = await this.load();
		const token = tokens.find((t) => t.id === id);
		return token ? summarize(token) : null;
	}

	async listByOrg(
		_ctx: RequestContext,
		orgId: string,
		opts?: ListOptions & { userId?: string }
	): Promise<Page<ApiTokenSummary>> {
		const { tokens } = await this.load();
		const filtered = tokens
			.filter((t) => t.orgId === orgId && (!opts?.userId || t.userId === opts.userId))
			.map(summarize);
		return paginate(applyOrder(filtered, opts), opts);
	}

	async revoke(ctx: RequestContext, id: string, reason: ApiTokenRevokeReason): Promise<void> {
		const file = await this.load();
		const token = file.tokens.find((t) => t.id === id);
		if (!token || token.revokedAt !== null) return;
		token.revokedAt = new Date().toISOString();
		await this.save(file);
		await this.emitRevoked(ctx, token, reason);
	}

	async revokeAllForUser(
		ctx: RequestContext,
		userId: string,
		opts: { orgId?: string; reason: ApiTokenRevokeReason }
	): Promise<string[]> {
		const file = await this.load();
		const doomed = file.tokens.filter(
			(t) => t.userId === userId && t.revokedAt === null && (!opts.orgId || t.orgId === opts.orgId)
		);
		if (doomed.length === 0) return [];
		const at = new Date().toISOString();
		for (const t of doomed) t.revokedAt = at;
		await this.save(file);
		for (const t of doomed) await this.emitRevoked(ctx, t, opts.reason);
		return doomed.map((t) => t.id);
	}

	async touchLastUsed(_ctx: RequestContext, id: string, at: string): Promise<void> {
		const file = await this.load();
		const token = file.tokens.find((t) => t.id === id);
		if (!token) return;
		token.lastUsedAt = at;
		await this.save(file);
	}

	async eraseUser(_ctx: RequestContext, userId: string): Promise<void> {
		const file = await this.load();
		const before = JSON.stringify(file.tokens);
		file.tokens = file.tokens
			.filter((t) => t.userId !== userId)
			.map((t) => (t.createdBy === userId ? { ...t, createdBy: null } : t));
		if (JSON.stringify(file.tokens) !== before) await this.save(file);
	}

	async deleteByOrg(_ctx: RequestContext, orgId: string): Promise<void> {
		const file = await this.load();
		const before = file.tokens.length;
		file.tokens = file.tokens.filter((t) => t.orgId !== orgId);
		if (file.tokens.length !== before) await this.save(file);
	}

	private emitRevoked(
		ctx: RequestContext,
		token: ApiToken,
		reason: ApiTokenRevokeReason
	): Promise<void> {
		return this.events.emit({
			type: 'api_token.revoked',
			apiTokenId: token.id,
			orgId: token.orgId,
			reason,
			...actorOf(ctx)
		});
	}
}
