// The cloud half of the live channel: one SSE stream per tab, carrying every solve this tab
// runs. The stream id is minted here rather than by the server so a solve request can name it
// before the stream has even connected.
//
// Opened when created, not on first subscribe: the server binds a solve to the stream only if
// the stream is already registered, and a lazily opened one was rarely connected by the time
// the first solve ran.

import type { SolveEvent } from '@selvajs/schemas';
import type { SolveEventSource } from '../drivers/driver.js';

const MIN_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 30_000;

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
	/** Final: the stream does not reopen, and a later subscriber hears nothing. */
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
	let reconnectMs = MIN_RECONNECT_MS;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

	function open() {
		if (source || typeof EventSource === 'undefined') return;
		const url = `${options.endpoint}${options.endpoint.includes('?') ? '&' : '?'}streamId=${streamId}`;
		const opened = new EventSource(url);
		source = opened;
		opened.addEventListener('open', () => {
			reconnectMs = MIN_RECONNECT_MS;
		});
		opened.addEventListener('solve', (raw) => {
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
		// EventSource reconnects after a dropped connection on its own, but a non-200 closes it for
		// good: one 502 during a deploy would end progress and cancel until a reload.
		opened.addEventListener('error', () => {
			if (opened.readyState !== EventSource.CLOSED || source !== opened) return;
			source = null;
			currentSolveId = null;
			reconnectTimer = setTimeout(open, reconnectMs);
			reconnectMs = Math.min(reconnectMs * 2, MAX_RECONNECT_MS);
		});
	}

	open();

	return {
		streamId,
		get currentSolveId() {
			return currentSolveId;
		},
		subscribe(listener) {
			listeners.add(listener);
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
			if (reconnectTimer) clearTimeout(reconnectTimer);
			source?.close();
			source = null;
			listeners.clear();
			currentSolveId = null;
		}
	};
}
