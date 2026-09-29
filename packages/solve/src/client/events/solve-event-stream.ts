// The cloud half of the live channel: one SSE stream per tab, opened lazily on the first
// subscriber, carrying every solve this tab runs. The stream id is minted here rather than by
// the server so a solve request can name it before the stream has even connected.

import type { SolveEvent } from '@selvajs/schemas';
import type { SolveEventSource } from './drivers/driver.js';

export interface SolveEventStreamOptions {
	/** The SSE endpoint, e.g. `/api/v1/solve-events`. `streamId` is appended as a query param. */
	endpoint: string;
	/** Builds the cancel URL for a solve, e.g. `(id) => \`/api/v1/solve/${id}/cancel\``. */
	cancelEndpoint: (solveId: string) => string;
	fetch?: typeof fetch;
}

export interface SolveEventStream extends SolveEventSource {
	/** Send this with every solve request so the server can route that solve's events here. */
	readonly streamId: string;
	/** The solve the server last reported as started and not yet ended; null between solves. */
	readonly currentSolveId: string | null;
	close(): void;
}

function mintStreamId(): string {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
		return crypto.randomUUID().replace(/-/g, '');
	}
	return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

export function createSolveEventStream(options: SolveEventStreamOptions): SolveEventStream {
	const streamId = mintStreamId();
	const listeners = new Set<(event: SolveEvent) => void>();
	const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
	let source: EventSource | null = null;
	let currentSolveId: string | null = null;

	function open() {
		if (source || typeof EventSource === 'undefined') return;
		const url = `${options.endpoint}${options.endpoint.includes('?') ? '&' : '?'}streamId=${streamId}`;
		source = new EventSource(url);
		source.addEventListener('solve', (raw) => {
			let event: SolveEvent;
			try {
				event = JSON.parse((raw as MessageEvent<string>).data);
			} catch {
				return;
			}
			if (event.type === 'solveStarted') currentSolveId = event.solveId;
			else if (event.type === 'solveEnded' && currentSolveId === event.solveId)
				currentSolveId = null;
			for (const listener of listeners) listener(event);
		});
		// EventSource reconnects on its own; nothing to do on error beyond not tearing down.
	}

	return {
		streamId,
		get currentSolveId() {
			return currentSolveId;
		},
		subscribe(listener) {
			listeners.add(listener);
			open();
			return () => {
				listeners.delete(listener);
			};
		},
		cancelCurrent() {
			const solveId = currentSolveId;
			if (!solveId) return;
			// Fire-and-forget: the answer arrives as `solveEnded` on the stream, or not at all if
			// the solve finished first, and either way there is nothing to await here.
			void doFetch(options.cancelEndpoint(solveId), { method: 'POST', keepalive: true }).catch(
				() => {}
			);
		},
		close() {
			source?.close();
			source = null;
			listeners.clear();
			currentSolveId = null;
		}
	};
}
