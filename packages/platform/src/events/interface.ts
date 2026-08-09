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
			/** Plain text, unlike every other identifier here — redacted on erasure via `redact_audit_event_email`. */
			email: string;
			actorId: string;
	  }
	| { type: 'invite.accepted'; inviteId: string; orgId: string; userId: string; actorId: string }
	| { type: 'invite.revoked'; inviteId: string; orgId: string; actorId: string }
	// `started` is emitted by the process that launches the update; the app
	// restarts mid-update, so the terminal event comes from post-restart
	// reconciliation of the persisted update log, not the launching process.
	| { type: 'system.update.started'; channel: string; fromVersion?: string; actorId: string }
	| {
			type: 'system.update.finished';
			fromVersion?: string;
			toVersion?: string;
			detail?: string;
			actorId: string;
	  }
	| {
			type: 'system.update.rolled_back';
			fromVersion?: string;
			toVersion?: string;
			detail?: string;
			actorId: string;
	  }
	| {
			type: 'system.update.failed';
			fromVersion?: string;
			toVersion?: string;
			detail?: string;
			actorId: string;
	  };

export type DomainEventType = DomainEvent['type'];

/**
 * A durable sink (e.g. Supabase `audit_events.event_version`) stamps every row
 * with this so a reader dispatches on an explicit version instead of
 * inferring the shape. Bump when the union's persisted form changes in a
 * non-additive way.
 */
export const AUDIT_EVENT_VERSION = 1;

export interface IEventSink {
	/**
	 * Stores call this AFTER a successful mutation; a failed write does not
	 * emit.
	 *
	 * MUST NOT throw — an exception here would surface as a failed write even
	 * though the mutation already committed. Implementations must catch
	 * network errors, queue overflows, and other failures internally and log
	 * them; the caller only ever sees a fulfilled promise.
	 *
	 * MAY be fire-and-forget: the contract is best-effort durable recording,
	 * not synchronous persistence. Adapters that queue and flush
	 * asynchronously are fine as long as they preserve event ordering per
	 * `actorId`.
	 */
	emit(event: DomainEvent): Promise<void>;
}

/**
 * `ctx.userId === ''` is the `SYSTEM_CONTEXT` convention for a server-internal
 * caller (bootstrap, janitors, migrations), which resolves to `'system'` here.
 */
export function actorFrom(ctx: { userId: string; system?: boolean }): string {
	return ctx.userId || 'system';
}

/** Discards every event. Used when `SelvaConfig.events` is omitted. */
export class NoopEventSink implements IEventSink {
	async emit(_event: DomainEvent): Promise<void> {}
}
