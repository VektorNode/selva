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

/** Default sink — does nothing. Swap in a real dispatcher via `SelvaConfig.events`. */
export class NoopEventSink implements IEventSink {
	async emit(_event: DomainEvent): Promise<void> {}
}
