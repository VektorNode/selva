// GrasshopperSource: the production SchemaSource. Wraps getWebSocketState(:8765); every
// WebSocket quirk (event-name dispatch, the saveSchema request/response handshake with
// its timeout) stays inside this adapter. The builder state never touches the socket.

import { getWebSocketState, type WebSocketState } from '$lib/websocket/websocket.svelte';
import type { UISchema } from '@selvajs/schemas';
import type { SolveReporter } from '@selvajs/ui';
import type {
	SchemaSource,
	SchemaSourceEvent,
	SchemaSourceHandler,
	SaveResult,
	ConnectResult,
	PreviewSolveDriver
} from './schema-source';
import { createWebSocketSolveDriver } from './websocket-solve-driver';
import type {
	WsSchemaSavedMessage,
	WsSchemaSaveRejectedMessage,
	SyncChange
} from '$lib/websocket/websocket.svelte';

const SAVE_TIMEOUT_MS = 10000;

export function createGrasshopperSource(wsState: WebSocketState, port: number): SchemaSource {
	return {
		get connected() {
			return wsState.connected;
		},

		on<E extends SchemaSourceEvent>(event: E, handler: SchemaSourceHandler<E>) {
			wsState.on(event, handler as (data: unknown) => void);
		},

		off<E extends SchemaSourceEvent>(event: E, handler: SchemaSourceHandler<E>) {
			wsState.off(event, handler as (data: unknown) => void);
		},

		async connect(sessionId: string): Promise<ConnectResult> {
			if (!sessionId) return { ok: false, error: 'No session ID provided' };
			const connected = await wsState.connect();
			if (!connected) {
				return {
					ok: false,
					error: `Failed to connect to Grasshopper via WebSocket on port ${port}. Make sure the UI Builder component is enabled.`
				};
			}
			return { ok: true };
		},

		requestInitialData(sessionId: string) {
			wsState.requestInitialData(sessionId);
		},

		save(sessionId: string, draft: UISchema, baseHash: string | null): Promise<SaveResult> {
			return new Promise<SaveResult>((resolve) => {
				if (!wsState.connected) {
					resolve({ ok: false, reason: 'Not connected to Grasshopper' });
					return;
				}

				let handled = false;

				const settle = (result: SaveResult) => {
					if (handled) return;
					handled = true;
					clearTimeout(timeoutId);
					wsState.off('schemaSaved', onSaved);
					wsState.off('schemaSaveRejected', onRejected);
					resolve(result);
				};

				const onSaved = (data: unknown) => {
					const message = data as WsSchemaSavedMessage;
					if (message.sessionId !== sessionId) return;
					if (message.success) settle({ ok: true });
					else settle({ ok: false, reason: message.message || 'Unknown error' });
				};

				const onRejected = (data: unknown) => {
					const message = data as WsSchemaSaveRejectedMessage;
					if (message.sessionId !== sessionId) return;
					// The state machine's own schemaSaveRejected handler has already replaced
					// canonical and tripped the conflict banner; from save()'s view it's a failure.
					settle({
						ok: false,
						reason: message.reason ?? 'Grasshopper changed since you started editing.'
					});
				};

				wsState.on('schemaSaved', onSaved);
				wsState.on('schemaSaveRejected', onRejected);

				const timeoutId = setTimeout(() => {
					settle({ ok: false, reason: 'Save timeout: no response from Grasshopper' });
				}, SAVE_TIMEOUT_MS);

				wsState.saveSchema(sessionId, draft, baseHash);
			});
		},

		requestSyncPreview(sessionId: string, draft: UISchema) {
			wsState.requestSyncPreview(sessionId, draft);
		},

		applySyncChanges(sessionId: string, changes: SyncChange[]) {
			wsState.applySyncChanges(sessionId, changes);
		},

		makeSolveDriver(sessionId: string, getReporter: () => SolveReporter): PreviewSolveDriver {
			return createWebSocketSolveDriver(wsState, sessionId, getReporter);
		}
	};
}

/** Convenience: build a GrasshopperSource bound to the singleton WS state for a port. */
export function getGrasshopperSource(port: number): SchemaSource {
	return createGrasshopperSource(getWebSocketState(port), port);
}
