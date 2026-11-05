import type { SelvaUploadRequest } from '@selvajs/schemas';
import type {
	SelvaSource,
	SelvaSourceEvent,
	SelvaSourceEvents,
	SelvaSourceHandler
} from './selva-source';

/** A command as it would go over the wire: `type` is the inbound message name the plugin reads. */
export type SentSelvaCommand =
	| { type: 'selvaGetAccount'; sessionId: string }
	| { type: 'selvaConnect'; sessionId: string; origin: string }
	| { type: 'selvaSignIn'; sessionId: string }
	| { type: 'selvaUseApiKey'; sessionId: string }
	| { type: 'selvaSignOut'; sessionId: string }
	| { type: 'selvaListTargets'; sessionId: string }
	| { type: 'selvaUpload'; sessionId: string; request: SelvaUploadRequest }
	| { type: 'selvaCancel'; sessionId: string };

export interface FakeSelvaSource extends SelvaSource {
	emit<E extends SelvaSourceEvent>(event: E, message: SelvaSourceEvents[E]): void;
	readonly sent: SentSelvaCommand[];
	setConnected(value: boolean): void;
}

export function createFakeSelvaSource(): FakeSelvaSource {
	const handlers = new Map<SelvaSourceEvent, Set<(message: unknown) => void>>();
	const sent: SentSelvaCommand[] = [];
	let connected = true;

	return {
		get connected() {
			return connected;
		},
		setConnected(value: boolean) {
			connected = value;
		},
		sent,

		on<E extends SelvaSourceEvent>(event: E, handler: SelvaSourceHandler<E>) {
			if (!handlers.has(event)) handlers.set(event, new Set());
			handlers.get(event)!.add(handler as (message: unknown) => void);
		},
		off<E extends SelvaSourceEvent>(event: E, handler: SelvaSourceHandler<E>) {
			handlers.get(event)?.delete(handler as (message: unknown) => void);
		},
		emit<E extends SelvaSourceEvent>(event: E, message: SelvaSourceEvents[E]) {
			handlers.get(event)?.forEach((handler) => handler(message));
		},

		getAccount: (sessionId) => sent.push({ type: 'selvaGetAccount', sessionId }),
		connectInstance: (sessionId, origin) => sent.push({ type: 'selvaConnect', sessionId, origin }),
		signIn: (sessionId) => sent.push({ type: 'selvaSignIn', sessionId }),
		useApiKey: (sessionId) => sent.push({ type: 'selvaUseApiKey', sessionId }),
		signOut: (sessionId) => sent.push({ type: 'selvaSignOut', sessionId }),
		listTargets: (sessionId) => sent.push({ type: 'selvaListTargets', sessionId }),
		upload: (sessionId, request) => sent.push({ type: 'selvaUpload', sessionId, request }),
		cancel: (sessionId) => sent.push({ type: 'selvaCancel', sessionId })
	};
}
