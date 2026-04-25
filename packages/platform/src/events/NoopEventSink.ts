import type { DomainEvent, IEventSink } from './interface.js';

/**
 * Default event sink — does nothing. Used until a deployment wires in a real
 * dispatcher (webhooks, audit log, analytics). Stores still call `emit` on
 * every mutation; the no-op sink swallows the calls without I/O.
 */
export class NoopEventSink implements IEventSink {
	async emit(_event: DomainEvent): Promise<void> {
		// intentionally empty
	}
}
