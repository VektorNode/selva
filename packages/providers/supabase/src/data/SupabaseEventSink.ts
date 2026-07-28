import {
	AUDIT_EVENT_VERSION,
	NoopLogger,
	type DomainEvent,
	type IEventSink,
	type ILogger
} from '@selvajs/platform';
import type { ClientBundle } from './client.js';

/**
 * Persists every domain event to `public.audit_events`. Writes use the
 * service-role client so RLS does not gate the audit trail — the sink runs
 * as a system process attached to whichever store emitted the event.
 *
 * Per the `IEventSink` contract, `emit` MUST NOT throw. The user-facing
 * mutation has already succeeded by the time we're here; a failed audit
 * write is logged and swallowed so the response still completes.
 */
export class SupabaseEventSink implements IEventSink {
	private readonly logger: ILogger;

	constructor(
		private readonly clients: ClientBundle,
		opts: { logger?: ILogger } = {}
	) {
		this.logger = opts.logger ?? new NoopLogger();
	}

	async emit(event: DomainEvent): Promise<void> {
		try {
			const { error } = await this.clients.serviceClient.from('audit_events').insert({
				type: event.type,
				actor_id: event.actorId,
				event_version: AUDIT_EVENT_VERSION,
				data: event
			});
			if (error) {
				// Only the event's identifiers are logged, never the whole event: an
				// `invite.created` payload embeds the invitee's email address, and log
				// records outlive and out-travel the audit row itself.
				this.logger.error('Audit event insert failed', {
					component: 'SupabaseEventSink',
					eventType: event.type,
					actorId: event.actorId,
					err: error.message
				});
			}
		} catch (err) {
			this.logger.error('Unexpected error writing audit event', {
				component: 'SupabaseEventSink',
				eventType: event.type,
				actorId: event.actorId,
				err: err instanceof Error ? (err.stack ?? err.message) : String(err)
			});
		}
	}
}
