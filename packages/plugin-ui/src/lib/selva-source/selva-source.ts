// SelvaSource: the seam between the upload dialog's state and the plugin's Selva client. The
// plugin signs in, holds the token and talks to Selva; the page only sends commands and reads
// what comes back. No method here takes or returns a credential, and none may.
//
// GrasshopperSelvaSource runs over the builder's WebSocket; FakeSelvaSource records commands
// and replays events for the node-env tests.

import type { SelvaUploadRequest } from '@selvajs/schemas';
import type {
	WsSelvaAccountMessage,
	WsSelvaTargetsMessage,
	WsSelvaUploadProgressMessage,
	WsSelvaUploadResultMessage
} from '#lib/websocket/websocket.svelte.js';

export interface SelvaSourceEvents {
	selvaAccount: WsSelvaAccountMessage;
	selvaTargets: WsSelvaTargetsMessage;
	selvaUploadProgress: WsSelvaUploadProgressMessage;
	selvaUploadResult: WsSelvaUploadResultMessage;
}

export type SelvaSourceEvent = keyof SelvaSourceEvents;

export type SelvaSourceHandler<E extends SelvaSourceEvent> = (
	message: SelvaSourceEvents[E]
) => void;

export interface SelvaSource {
	readonly connected: boolean;

	on<E extends SelvaSourceEvent>(event: E, handler: SelvaSourceHandler<E>): void;
	off<E extends SelvaSourceEvent>(event: E, handler: SelvaSourceHandler<E>): void;

	/** Answered with `selvaAccount`. */
	getAccount(sessionId: string): void;
	/** `origin` is the URL as the user typed it; the plugin normalises and validates it. */
	connectInstance(sessionId: string, origin: string): void;
	/** Opens the system browser on the instance from the last accepted `connectInstance`. */
	signIn(sessionId: string): void;
	/** Opens a dialog in Rhino to paste a key, so the key never passes through the page. */
	useApiKey(sessionId: string): void;
	signOut(sessionId: string): void;
	/** Answered with `selvaTargets`. */
	listTargets(sessionId: string): void;
	upload(sessionId: string, request: SelvaUploadRequest): void;
	/** Stops a sign-in or an upload in flight. */
	cancel(sessionId: string): void;
}
