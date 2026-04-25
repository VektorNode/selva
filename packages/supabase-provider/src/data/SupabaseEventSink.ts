import type { DomainEvent, IEventSink } from '@selva/platform';
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
	constructor(private readonly clients: ClientBundle) {}

	async emit(event: DomainEvent): Promise<void> {
		try {
			const { error } = await this.clients.serviceClient.from('audit_events').insert({
				type: event.type,
				actor_id: event.actorId,
				data: event
			});
			if (error) {
				console.error('[SupabaseEventSink] insert failed:', error.message, { event });
			}
		} catch (err) {
			console.error('[SupabaseEventSink] unexpected error:', err, { event });
		}
	}
}
