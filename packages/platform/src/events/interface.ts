/**
 * Domain-event sink (Permissions.md §9). Every successful mutation in a data
 * store emits one event. Today the only implementation is `NoopEventSink`;
 * future webhook dispatch, audit-log writers, and analytics consumers plug
 * in by swapping the implementation in `SelvaConfig`.
 *
 * ## Contract
 *
 * - Stores call `emit` AFTER the write succeeds. A failed write must not emit.
 * - `emit` MUST NOT throw — failures are the sink's problem (log + swallow).
 *   The user-facing operation already succeeded.
 * - `actorId` is the user who triggered the change. For system-context
 *   mutations (bootstrap, janitor, migrations) the literal string `'system'`
 *   is used so consumers can filter or attribute appropriately.
 */

export type DomainEvent =
	| { type: 'org.created'; orgId: string; actorId: string }
	| { type: 'org.deleted'; orgId: string; actorId: string }
	| { type: 'org_member.added'; orgId: string; userId: string; actorId: string }
	| { type: 'org_member.removed'; orgId: string; userId: string; actorId: string }
	| { type: 'project.created'; projectId: string; orgId: string; actorId: string }
	| { type: 'project.deleted'; projectId: string; actorId: string }
	| { type: 'project_member.added'; projectId: string; userId: string; actorId: string }
	| { type: 'project_member.removed'; projectId: string; userId: string; actorId: string }
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
	| { type: 'share_link.revoked'; linkId: string; actorId: string };

export type DomainEventType = DomainEvent['type'];

export interface IEventSink {
	emit(event: DomainEvent): Promise<void>;
}

/** Resolve the actor id from a RequestContext, falling back to `'system'`. */
export function actorFrom(ctx: { userId: string; system?: boolean }): string {
	return ctx.userId || 'system';
}
