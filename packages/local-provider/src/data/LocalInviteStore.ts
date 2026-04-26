import * as path from 'node:path';
import type {
	IInviteStore,
	IEventSink,
	Invite,
	RequestContext,
	ListOptions,
	Page
} from '@selva/platform';
import { NoopEventSink, actorFrom } from '@selva/platform';
import { paginate, applyOrder } from './pagination.js';
import { readJsonFile, writeJsonFile } from './fsJson.js';

interface InvitesFile {
	invites: Invite[];
}
const EMPTY: InvitesFile = { invites: [] };

/**
 * Legacy invite records carried a flat `permissions` array. Drop anything
 * that isn't a valid OrgPermission (platform-scope perms are never
 * invite-grantable) and store the result under `orgPermissions`.
 */
const VALID_ORG_PERMS = new Set([
	'manage_org_members',
	'manage_org_compute',
	'manage_definitions',
	'manage_projects'
]);

function migrateInvite(i: Invite & { permissions?: string[] }): Invite {
	if (i.orgPermissions === undefined) {
		const legacy = i.permissions ?? [];
		i.orgPermissions = legacy.filter((p) => VALID_ORG_PERMS.has(p)) as Invite['orgPermissions'];
		delete i.permissions;
	}
	return i;
}

/**
 * Filesystem-backed invite store. No per-call scoping by ctx.userId — the
 * route layer gates admin actions. `getByTokenHash` is the sole unauthenticated
 * read and is scoped by the hashed token (caller hashes the raw URL token
 * before lookup); it hides expired and already-accepted invites so a reused
 * link surfaces a clean error.
 */
export class LocalInviteStore implements IInviteStore {
	private readonly filePath: string;

	static fromEnv(
		env: Record<string, string | undefined>,
		events: IEventSink = new NoopEventSink()
	): LocalInviteStore {
		if (!env.DATA_PATH) throw new Error('Missing required env var: DATA_PATH');
		return new LocalInviteStore(env.DATA_PATH, events);
	}

	constructor(
		dataPath: string,
		private readonly events: IEventSink = new NoopEventSink()
	) {
		this.filePath = path.join(dataPath, 'invites.json');
	}

	private async load(): Promise<InvitesFile> {
		return readJsonFile<InvitesFile>(this.filePath, EMPTY);
	}

	private async save(file: InvitesFile): Promise<void> {
		await writeJsonFile(this.filePath, file);
	}

	async create(ctx: RequestContext, invite: Invite): Promise<void> {
		const file = await this.load();
		file.invites.push(invite);
		await this.save(file);
		await this.events.emit({
			type: 'invite.created',
			inviteId: invite.id,
			orgId: invite.orgId,
			email: invite.email,
			actorId: actorFrom(ctx)
		});
	}

	async getByTokenHash(_ctx: RequestContext, tokenHash: string): Promise<Invite | null> {
		const { invites } = await this.load();
		const invite = invites.find((i) => i.tokenHash === tokenHash);
		if (!invite) return null;
		if (invite.acceptedAt) return null;
		if (Date.parse(invite.expiresAt) <= Date.now()) return null;
		return migrateInvite(invite);
	}

	async listByOrg(_ctx: RequestContext, orgId: string, opts?: ListOptions): Promise<Page<Invite>> {
		const { invites } = await this.load();
		const filtered = invites.filter((i) => i.orgId === orgId).map(migrateInvite);
		return paginate(applyOrder(filtered, opts), opts);
	}

	async markAccepted(ctx: RequestContext, id: string, userId: string): Promise<void> {
		const file = await this.load();
		const invite = file.invites.find((i) => i.id === id);
		if (!invite || invite.acceptedAt) return;
		invite.acceptedAt = new Date().toISOString();
		invite.acceptedByUserId = userId;
		await this.save(file);
		await this.events.emit({
			type: 'invite.accepted',
			inviteId: invite.id,
			orgId: invite.orgId,
			userId,
			actorId: actorFrom(ctx)
		});
	}

	async revoke(ctx: RequestContext, id: string): Promise<void> {
		const file = await this.load();
		const target = file.invites.find((i) => i.id === id && !i.acceptedAt);
		if (!target) return;
		file.invites = file.invites.filter((i) => i.id !== id || i.acceptedAt);
		await this.save(file);
		await this.events.emit({
			type: 'invite.revoked',
			inviteId: id,
			orgId: target.orgId,
			actorId: actorFrom(ctx)
		});
	}

	async deleteByOrg(_ctx: RequestContext, orgId: string): Promise<void> {
		const file = await this.load();
		const before = file.invites.length;
		file.invites = file.invites.filter((i) => i.orgId !== orgId);
		if (file.invites.length === before) return;
		await this.save(file);
	}
}
