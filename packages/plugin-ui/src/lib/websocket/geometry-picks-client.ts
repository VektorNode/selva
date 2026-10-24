// Viewport picks for geometry inputs. The plugin prompts on Rhino's command line with the param's
// own filter and count, keeps the geometry on the param, and answers with a summary only. Every
// request gets exactly one reply, matched by requestId. The reply goes to every page on the
// bridge, so a requestId must be unique across pages and reloads, not just within this one.

import type { GeometryPickResult } from '@selvajs/ui';

/** The slice of WebSocketState this needs; a fake stands in for it in tests. */
export interface GeometryPickSocket {
	readonly connected: boolean;
	send(type: string, data: Record<string, unknown>): void;
	on(type: string, handler: (data: unknown) => void): void;
}

type Reply = {
	requestId: string;
	outcome: 'picked' | 'cancelled' | 'failed';
	summary?: string | null;
	error?: string | null;
};

const NOT_CONNECTED = 'Not connected to Grasshopper.';
const CONNECTION_LOST = 'Lost the connection to Grasshopper before the pick finished.';

export function createGeometryPicksClient(socket: GeometryPickSocket, getSessionId: () => string) {
	const pending = new Map<string, (result: GeometryPickResult) => void>();

	// The dispatcher has validated each reply against messageSchemas.ts.
	socket.on('pickGeometryResult', (data) => {
		const reply = data as Reply;
		const resolve = pending.get(reply.requestId);
		if (!resolve) return;
		pending.delete(reply.requestId);
		if (reply.outcome === 'picked') resolve({ outcome: 'picked', summary: reply.summary ?? '' });
		else if (reply.outcome === 'failed')
			resolve({ outcome: 'failed', error: reply.error || 'The pick failed.' });
		else resolve({ outcome: 'cancelled' });
	});
	socket.on('socketClosed', () => {
		for (const resolve of pending.values()) resolve({ outcome: 'failed', error: CONNECTION_LOST });
		pending.clear();
	});

	return {
		/** True while Rhino is prompting for a pick this page asked for. */
		get picking() {
			return pending.size > 0;
		},

		pickGeometry(paramId: string): Promise<GeometryPickResult> {
			if (!socket.connected) return Promise.resolve({ outcome: 'failed', error: NOT_CONNECTED });
			const requestId = crypto.randomUUID();
			return new Promise((resolve) => {
				pending.set(requestId, resolve);
				socket.send('pickGeometry', { sessionId: getSessionId(), requestId, paramId });
			});
		},

		clearGeometry(paramId: string) {
			socket.send('clearGeometry', { sessionId: getSessionId(), paramId });
		}
	};
}
