import type { ILogger } from '../logging/interface.js';
import type { OutboundMessage, SendResult } from './types.js';

/**
 * Transport for outbound messages. Knows how to put a message on the wire and
 * nothing about what is in it — rendering lives in `@selvajs/notifications`,
 * and the decision to send at all lives in the app's dispatcher.
 *
 * Kept out of `IDataProvider` because a transport is not storage: an instance
 * may swap SMTP for an HTTP mail API without touching its data layer.
 */
export interface INotificationProvider {
	/** Human-readable name for admin screens and logs, e.g. "SMTP". */
	readonly name: string;

	/**
	 * Deliver one message.
	 *
	 * MUST NOT throw. A notification is never the thing the user asked for, so
	 * it must never be the thing that fails their request: by the time this is
	 * called the invite row is already committed and the caller still holds the
	 * accept URL to share by hand. Implementations catch their own failures and
	 * report them as `{ status: 'failed' }`.
	 *
	 * Log identifiers only — recipient and kind, at warn/error, which is the
	 * minimum needed to diagnose a bounce. Never the subject or body.
	 */
	send(message: OutboundMessage, log?: ILogger): Promise<SendResult>;

	/**
	 * Whether this instance can send at all. Drives UI copy ("invitees will be
	 * emailed" vs "copy the link"), so it must answer without attempting a
	 * delivery and without throwing on a half-finished config.
	 */
	isConfigured(): boolean;
}

/**
 * Default `INotificationProvider` — sends nothing, reports `not-configured`.
 *
 * Mail is optional in every deployment, so this is a supported wiring rather
 * than a test double: callers already handle `not-configured` as "no mail",
 * which keeps the no-SMTP path identical to the pre-notification behaviour.
 */
export class NoopNotificationProvider implements INotificationProvider {
	readonly name = 'None';

	async send(_message: OutboundMessage, _log?: ILogger): Promise<SendResult> {
		return { status: 'not-configured' };
	}

	isConfigured(): boolean {
		return false;
	}
}
