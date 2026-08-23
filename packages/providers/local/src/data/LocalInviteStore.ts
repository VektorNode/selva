import * as path from 'node:path';
import type {
	IInviteStore,
	IEventSink,
	Invite,
	RequestContext,
	ListOptions,
	Page
} from '@selvajs/platform';
import { NoopEventSink, actorFrom } from '@selvajs/platform';
import { paginate, applyOrder } from './pagination.js';
import { readJsonFile, writeJsonFile } from './fsJson.js';

interface InvitesFile {
	invites: Invite[];
}
// Factory, not a shared constant: `readJsonFile` returns its fallback by
// reference on a missing file, and `create` mutates it via `.push`. A shared
// object would leak those mutations across requests.
const empty = (): InvitesFile => ({ invites: [] });

/**
 * No per-call scoping by ctx.userId — the route layer gates admin actions.
 * `getByTokenHash` is the sole unauthenticated read; it hides expired and
 * already-accepted invites so a reused link surfaces a clean error.
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
		return readJsonFile<InvitesFile>(this.filePath, empty());
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
		return invite;
	}

	async listByOrg(_ctx: RequestContext, orgId: string, opts?: ListOptions): Promise<Page<Invite>> {
		const { invites } = await this.load();
		const filtered = invites.filter((i) => i.orgId === orgId);
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

	async revokePendingByEmail(ctx: RequestContext, orgId: string, email: string): Promise<string[]> {
		// Emails are stored lowercase at mint time; normalize the needle too so an
		// offboarding call with the address as the admin typed it still matches.
		const needle = email.trim().toLowerCase();
		const file = await this.load();
		const doomed = file.invites.filter(
			(i) => i.orgId === orgId && !i.acceptedAt && i.email.toLowerCase() === needle
		);
		if (doomed.length === 0) return [];

		const ids = new Set(doomed.map((i) => i.id));
		file.invites = file.invites.filter((i) => !ids.has(i.id));
		await this.save(file);
		for (const invite of doomed) {
			await this.events.emit({
				type: 'invite.revoked',
				inviteId: invite.id,
				orgId: invite.orgId,
				actorId: actorFrom(ctx)
			});
		}
		return [...ids];
	}

	async deleteByOrg(_ctx: RequestContext, orgId: string): Promise<void> {
		const file = await this.load();
		const before = file.invites.length;
		file.invites = file.invites.filter((i) => i.orgId !== orgId);
		if (file.invites.length === before) return;
		await this.save(file);
	}
}
