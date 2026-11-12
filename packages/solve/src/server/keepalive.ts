import {
	KEEPALIVE_INTERVAL_MS,
	KEEPALIVE_PREFERENCE,
	type KeepaliveMeta
} from '../shared/keepalive.js';

const SPACE = new Uint8Array([0x20]);

/** True when the request asked for a keep-alive response (`Prefer: selva-keepalive`). */
export function wantsKeepalive(request: Request): boolean {
	const prefer = request.headers.get('Prefer');
	if (!prefer) return false;
	return prefer
		.split(',')
		.some((token) => token.split(';')[0].trim().toLowerCase() === KEEPALIVE_PREFERENCE);
}

/**
 * Answers 200 at once and holds the connection with a space every `intervalMs` until `work`
 * settles, then sends its status, headers and body (wire format in `shared/keepalive.ts`).
 *
 * `work` must resolve to every outcome, errors included: once the 200 is out, a rejection can
 * only drop the connection.
 */
export function respondWithKeepalive(
	work: Promise<Response>,
	intervalMs: number = KEEPALIVE_INTERVAL_MS
): Response {
	let timer: ReturnType<typeof setInterval> | undefined;
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			// Sent now so headers leave at once: some proxies also cap the wait for the first byte.
			controller.enqueue(SPACE);
			timer = setInterval(() => controller.enqueue(SPACE), intervalMs);
			work
				.then(async (response) => {
					clearInterval(timer);
					const meta: KeepaliveMeta = { status: response.status, headers: [...response.headers] };
					controller.enqueue(new TextEncoder().encode(`${JSON.stringify(meta)}\n`));
					if (response.body) {
						const reader = response.body.getReader();
						for (;;) {
							const { done, value } = await reader.read();
							if (done) break;
							controller.enqueue(value);
						}
					}
					controller.close();
				})
				.catch((err) => {
					clearInterval(timer);
					controller.error(err);
				});
		},
		cancel() {
			clearInterval(timer);
		}
	});

	return new Response(body, {
		status: 200,
		headers: {
			'Content-Type': 'application/octet-stream',
			'Cache-Control': 'no-store',
			'Preference-Applied': KEEPALIVE_PREFERENCE
		}
	});
}
