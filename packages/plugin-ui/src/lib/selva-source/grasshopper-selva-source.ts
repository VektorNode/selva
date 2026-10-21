import type { SelvaUploadRequest } from '@selvajs/schemas';
import { getWebSocketState, type WebSocketState } from '$lib/websocket/websocket.svelte';
import type { SelvaSource, SelvaSourceEvent, SelvaSourceHandler } from './selva-source';

/** Rides the builder's socket: `connected` is true only once the plugin accepted the page's secret. */
export function createGrasshopperSelvaSource(wsState: WebSocketState): SelvaSource {
	return {
		get connected() {
			return wsState.connected;
		},

		on<E extends SelvaSourceEvent>(event: E, handler: SelvaSourceHandler<E>) {
			wsState.on(event, handler as (data: unknown) => void);
		},

		off<E extends SelvaSourceEvent>(event: E, handler: SelvaSourceHandler<E>) {
			wsState.off(event, handler as (data: unknown) => void);
		},

		getAccount(sessionId: string) {
			wsState.send('selvaGetAccount', { sessionId });
		},

		connectInstance(sessionId: string, origin: string) {
			wsState.send('selvaConnect', { sessionId, origin });
		},

		signIn(sessionId: string) {
			wsState.send('selvaSignIn', { sessionId });
		},

		useApiKey(sessionId: string) {
			wsState.send('selvaUseApiKey', { sessionId });
		},

		signOut(sessionId: string) {
			wsState.send('selvaSignOut', { sessionId });
		},

		listTargets(sessionId: string) {
			wsState.send('selvaListTargets', { sessionId });
		},

		upload(sessionId: string, request: SelvaUploadRequest) {
			wsState.send('selvaUpload', { sessionId, request });
		},

		cancel(sessionId: string) {
			wsState.send('selvaCancel', { sessionId });
		}
	};
}

export function getGrasshopperSelvaSource(port: number): SelvaSource {
	return createGrasshopperSelvaSource(getWebSocketState(port));
}
