/**
 * Domain-event sink. Stores call `emit` AFTER a successful mutation; failed
 * writes do not emit. `emit` MUST NOT throw — failures are the sink's
 * problem to log and swallow.
 *
 * `actorId` is the user who triggered the change, or `'system'` for
 * SYSTEM_CONTEXT mutations (bootstrap, janitor, migrations).
 */

export type DomainEvent =
	| { type: 'org.created'; orgId: string; actorId: string }
	| { type: 'org.deleted'; orgId: string; actorId: string }
	| { type: 'org_member.added'; orgId: string; userId: string; actorId: string }
	| { type: 'org_member.removed'; orgId: string; userId: string; actorId: string }
	| {
			type: 'org_member.role_changed';
			orgId: string;
			userId: string;
			role: string;
			actorId: string;
	  }
	| {
			type: 'org_member.permissions_changed';
			orgId: string;
			userId: string;
			permissions: readonly string[];
			actorId: string;
	  }
	| { type: 'project.created'; projectId: string; orgId: string; actorId: string }
	| { type: 'project.deleted'; projectId: string; actorId: string }
	| { type: 'project_member.added'; projectId: string; userId: string; actorId: string }
	| { type: 'project_member.removed'; projectId: string; userId: string; actorId: string }
	| {
			type: 'project_member.role_changed';
			projectId: string;
			userId: string;
			role: string;
			actorId: string;
	  }
	| { type: 'definition.created'; definitionId: string; projectId: string; actorId: string }
	| { type: 'definition.deleted'; definitionId: string; actorId: string }
	| { type: 'definition.published'; definitionId: string; versionId: string; actorId: string }
	| {
			type: 'definition_version.created';
			versionId: string;
			definitionId: string;
			actorId: string;
	  }
	| { type: 'definition_version.deleted'; versionId: string; actorId: string }
	| { type: 'share_link.minted'; linkId: string; definitionId: string; actorId: string }
	| { type: 'share_link.revoked'; linkId: string; actorId: string }
	| {
			type: 'invite.created';
			inviteId: string;
			orgId: string;
			email: string;
			actorId: string;
	  }
	| { type: 'invite.accepted'; inviteId: string; orgId: string; userId: string; actorId: string }
	| { type: 'invite.revoked'; inviteId: string; orgId: string; actorId: string };

export type DomainEventType = DomainEvent['type'];

export interface IEventSink {
	/**
	 * Record a domain event. Called by stores AFTER a successful mutation; a
	 * failed write does not emit.
	 *
	 * MUST NOT throw — this method is on the hot path of every mutating
	 * operation, and an exception here would surface as a failed write even
	 * though the actual mutation already committed. Implementations MUST
	 * catch network errors, queue overflows, and any other transient or
	 * persistent failures internally and log them; the only side effect
	 * visible to the caller is a fulfilled promise.
	 *
	 * MAY be fire-and-forget — the contract is "best-effort durable
	 * recording," not synchronous persistence. Adapters that queue + flush
	 * asynchronously are valid as long as they preserve event ordering per
	 * `actorId`.
	 */
	emit(event: DomainEvent): Promise<void>;
}

/**
 * Resolve the actor id from a RequestContext. Returns `ctx.userId` when set,
 * `'system'` otherwise — matches the `SYSTEM_CONTEXT` convention where
 * `userId === ''` denotes a server-internal caller (bootstrap, janitors,
 * migrations).
 */
export function actorFrom(ctx: { userId: string; system?: boolean }): string {
	return ctx.userId || 'system';
}

/**
 * Default `IEventSink` — discards every event. Used when `SelvaConfig.events`
 * is omitted, and as the safe fallback for adapters whose data layer has no
 * event log (local-provider). Drop-in replace via `SelvaConfig.events` once a
 * real dispatcher is wired.
 */
export class NoopEventSink implements IEventSink {
	async emit(_event: DomainEvent): Promise<void> {}
}
