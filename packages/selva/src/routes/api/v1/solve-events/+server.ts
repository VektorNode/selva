import type { RequestHandler } from './$types';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { getSolveEventBus } from '$lib/server/solveEvents/bus.server';
import type { SolveEvent } from '@selvajs/schemas';

// One SSE stream per browser tab. The tab mints `streamId` and sends it with every
// solve request; the server routes that solve's events here. Self-gating (the hook
// does not deny it) because the sibling callback route under the same prefix has no
// session at all — this route still requires one.

const STREAM_ID = /^[A-Za-z0-9_-]{16,64}$/;
const HEARTBEAT_MS = 20_000;

export const GET: RequestHandler = async ({ url, locals, request }) => {
	if (!locals.user) apiError(401, ApiErrorCode.UNAUTHORIZED, 'Unauthorized');

	const streamId = url.searchParams.get('streamId') ?? '';
	if (!STREAM_ID.test(streamId)) {
		apiError(400, ApiErrorCode.VALIDATION_FAILED, 'streamId must be 16-64 URL-safe characters');
	}

	// Must match the owner key `runSolve` uses for a logged-in caller.
	const ownerKey = `user:${locals.user.id}`;
	const bus = getSolveEventBus();
	const encoder = new TextEncoder();

	let close: () => void = () => {};
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			let eventId = 0;
			const send = (chunk: string) => {
				try {
					controller.enqueue(encoder.encode(chunk));
				} catch {
					close();
				}
			};
			const write = (event: SolveEvent) => {
				send(`id: ${++eventId}\nevent: solve\ndata: ${JSON.stringify(event)}\n\n`);
			};

			const unsubscribe = bus.openStream(streamId, ownerKey, write);
			// Comment frames keep idle proxies from closing the connection.
			const heartbeat = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS);
			let closed = false;
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
			request.signal.addEventListener('abort', close, { once: true });

			send(`event: ready\ndata: ${JSON.stringify({ streamId })}\n\n`);
		},
		cancel() {
			close();
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			// nginx buffers responses by default; this header turns it off per response.
			'X-Accel-Buffering': 'no'
		}
	});
};
