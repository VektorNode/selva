// Viewport picks for geometry inputs. The plugin prompts on Rhino's command line with the param's
// own filter and count, keeps the geometry on the param, and answers with a summary only.

import type { GeometryPickResult } from '@selvajs/ui';
import { createPendingRequests, type ReplySocket } from './pending-requests';

/** The slice of WebSocketState this needs; a fake stands in for it in tests. */
export interface GeometryPickSocket extends ReplySocket {
	readonly connected: boolean;
	send(type: string, data: Record<string, unknown>): void;
}

type Reply = {
	requestId: string;
	paramId: string;
	outcome: 'picked' | 'cancelled' | 'failed';
	summary?: string | null;
	error?: string | null;
};

const NOT_CONNECTED = 'Not connected to Grasshopper.';
const CONNECTION_LOST = 'Lost the connection to Grasshopper before the pick finished.';

function toResult(reply: Reply): GeometryPickResult {
	if (reply.outcome === 'picked') return { outcome: 'picked', summary: reply.summary ?? '' };
	if (reply.outcome === 'failed')
		return { outcome: 'failed', error: reply.error || 'The pick failed.' };
	return { outcome: 'cancelled' };
}

type SummaryListener = (summary: string | null) => void;

export function createGeometryPicksClient(socket: GeometryPickSocket, getSessionId: () => string) {
	const summaryListeners = new Map<string, Set<SummaryListener>>();
	const notify = (paramId: string, summary: string | null) => {
		for (const listener of summaryListeners.get(paramId) ?? []) listener(summary);
	};

	// A pick or a clear changes the param for every page showing it, not only the one that asked.
	const pending = createPendingRequests<Reply>(socket, {
		replyTypes: ['pickGeometryResult'],
		connectionLost: () => new Error(CONNECTION_LOST),
		onReply: (reply) => {
			if (reply.outcome === 'picked') notify(reply.paramId, reply.summary ?? '');
		}
	});
	socket.on('geometrySummary', (data) => {
		const { paramId, summary } = data as { paramId: string; summary: string | null };
		notify(paramId, summary);
	});

	return {
		/** True while Rhino is prompting for a pick this page asked for. */
		get picking() {
			return pending.size > 0;
		},

		pickGeometry(paramId: string): Promise<GeometryPickResult> {
			if (!socket.connected) return Promise.resolve({ outcome: 'failed', error: NOT_CONNECTED });
			return pending
				.request((requestId) =>
					socket.send('pickGeometry', { sessionId: getSessionId(), requestId, paramId })
				)
				.then(toResult, (error: Error) => ({ outcome: 'failed', error: error.message }));
		},

		clearGeometry(paramId: string) {
			socket.send('clearGeometry', { sessionId: getSessionId(), paramId });
		},

		/**
		 * Calls `listener` with what `paramId` holds after every pick or clear, whichever page
		 * asked; null when nothing is picked into it.
		 */
		onGeometrySummary(paramId: string, listener: SummaryListener): () => void {
			let listeners = summaryListeners.get(paramId);
			if (!listeners) summaryListeners.set(paramId, (listeners = new Set()));
			listeners.add(listener);
			return () => listeners.delete(listener);
		}
	};
}
