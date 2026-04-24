import * as path from 'node:path';
import type {
	IInviteStore,
	Invite,
	RequestContext,
	ListOptions,
	Page
} from '@selva/platform';
import { paginate, applyOrder } from '../pagination.js';
import { readJsonFile, writeJsonFile } from '../fsJson.js';

interface InvitesFile {
	invites: Invite[];
}
const EMPTY: InvitesFile = { invites: [] };

/**
 * Filesystem-backed invite store (invites.json in DATA_PATH).
 *
 * Notes:
 * - No explicit per-call scoping by ctx.userId — the route layer gates
 *   admin actions (manage_users + correct org). `getByToken` is the one
 *   unauthenticated read and is implicitly scoped by the secret token.
 * - Expired or already-accepted invites are hidden from `getByToken` so
 *   a reused link returns null and the public route surfaces a clean error.
 */
export class LocalInviteProvider implements IInviteStore {
	private readonly filePath: string;

	static fromEnv(env: Record<string, string | undefined>): LocalInviteProvider {
		if (!env.DATA_PATH) throw new Error('Missing required env var: DATA_PATH');
		return new LocalInviteProvider(env.DATA_PATH);
	}

	constructor(dataPath: string) {
		this.filePath = path.join(dataPath, 'invites.json');
	}

	private async load(): Promise<InvitesFile> {
		return readJsonFile<InvitesFile>(this.filePath, EMPTY);
	}

	private async save(file: InvitesFile): Promise<void> {
		await writeJsonFile(this.filePath, file);
	}

	async create(_ctx: RequestContext, invite: Invite): Promise<void> {
		const file = await this.load();
		file.invites.push(invite);
		await this.save(file);
	}

	async getByToken(_ctx: RequestContext, token: string): Promise<Invite | null> {
		const { invites } = await this.load();
		const invite = invites.find((i) => i.token === token);
		if (!invite) return null;
		if (invite.acceptedAt) return null;
		if (Date.parse(invite.expiresAt) <= Date.now()) return null;
		return invite;
	}

	async listByOrg(
		_ctx: RequestContext,
		orgId: string,
		opts?: ListOptions
	): Promise<Page<Invite>> {
		const { invites } = await this.load();
		const filtered = invites.filter((i) => i.orgId === orgId);
		return paginate(applyOrder(filtered, opts), opts);
	}

	async markAccepted(_ctx: RequestContext, id: string, userId: string): Promise<void> {
		const file = await this.load();
		const invite = file.invites.find((i) => i.id === id);
		if (!invite || invite.acceptedAt) return;
		invite.acceptedAt = new Date().toISOString();
		invite.acceptedByUserId = userId;
		await this.save(file);
	}

	async revoke(_ctx: RequestContext, id: string): Promise<void> {
		const file = await this.load();
		const before = file.invites.length;
		file.invites = file.invites.filter((i) => i.id !== id || i.acceptedAt);
		if (file.invites.length !== before) await this.save(file);
	}
}
