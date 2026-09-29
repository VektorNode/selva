import type { SolveEvent } from '@selvajs/schemas';
import type { SolveEventBus } from './bus.server';

/** Comment frames keep idle proxies from closing the connection. */
const HEARTBEAT_MS = 20_000;

/**
 * The SSE response for one browser stream: registers it on the bus, frames each event as
 * `event: solve`, and unregisters when the client goes. Null when another owner holds `streamId`.
 */
export function openSolveEventStream(args: {
	bus: SolveEventBus;
	streamId: string;
	ownerKey: string;
	signal: AbortSignal;
}): Response | null {
	const { bus, streamId, ownerKey, signal } = args;
	const encoder = new TextEncoder();

	// Registered before the stream exists so a refusal can still become a status code.
	let write: (event: SolveEvent) => void = () => {};
	const unsubscribe = bus.openStream(streamId, ownerKey, (event) => write(event));
	if (!unsubscribe) return null;

	let close: () => void = () => {};
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			let eventId = 0;
			let closed = false;
			const send = (chunk: string) => {
				try {
					controller.enqueue(encoder.encode(chunk));
				} catch {
					close();
				}
			};
			write = (event) => send(`id: ${++eventId}\nevent: solve\ndata: ${JSON.stringify(event)}\n\n`);

			const heartbeat = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS);
			close = () => {
				if (closed) return;
				closed = true;
				clearInterval(heartbeat);
				unsubscribe();
				try {
					controller.close();
				} catch {
					// Already closed by the client.
				}
			};
			signal.addEventListener('abort', close, { once: true });
			if (signal.aborted) close();

			send(`event: ready\ndata: ${JSON.stringify({ streamId })}\n\n`);
		},
		cancel() {
			close();
		}
	});

	return new Response(body, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			// nginx buffers responses by default; this header turns it off per response.
			'X-Accel-Buffering': 'no'
		}
	});
}
