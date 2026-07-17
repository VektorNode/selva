import type { RequestHandler } from './$types';
import { randomFillSync } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';

// Transport throughput probe (SELVA_FLAG_COMPUTE_DEBUG only): streams N MB of
// random bytes through the exact same stack a solve response takes (Node →
// reverse proxy → wire → client) with zero compute involvement. Comparing its
// MB/s from different vantage points isolates a slow segment:
//   • curl on the server host against 127.0.0.1:<node port>  → Node/Selva only
//   • curl on the server host against https://<domain>       → + Caddy, no wire
//   • browser / curl from the client machine                 → full path
// Random bytes are deliberately incompressible so proxy compression can't fake
// a fast transfer. Hidden (404) unless the debug flag is on; auth still required
// so the endpoint can't be used as an anonymous bandwidth sink.
const COMPUTE_DEBUG = ['true', '1', 'yes'].includes(
	(env.SELVA_FLAG_COMPUTE_DEBUG ?? '').toLowerCase()
);

const CHUNK_BYTES = 1024 * 1024;
const DEFAULT_MB = 20;
const MAX_MB = 64;

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!COMPUTE_DEBUG) apiError(404, ApiErrorCode.NOT_FOUND, 'Not found');
	if (!locals.user) apiError(401, ApiErrorCode.UNAUTHORIZED, 'Unauthorized');

	const requested = Number(url.searchParams.get('mb'));
	const mb = Math.min(MAX_MB, Math.max(1, Number.isFinite(requested) ? requested : DEFAULT_MB));

	// Pull-based stream: each pull waits for the socket to drain, so the elapsed
	// time here ≈ the client's receive rate as seen FROM the server. If this logs
	// slow while a localhost curl is fast, the slowness is past Node (proxy/wire).
	let sentChunks = 0;
	const start = performance.now();
	const stream = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (sentChunks >= mb) {
				controller.close();
				const secs = (performance.now() - start) / 1000;
				locals.log.debug('Streamed throughput probe (server-side view)', {
					component: 'Compute/diag',
					megabytes: mb,
					durationSec: Number(secs.toFixed(1)),
					throughputMbPerSec: Number((mb / secs).toFixed(1))
				});
				return;
			}
			const chunk = new Uint8Array(CHUNK_BYTES);
			randomFillSync(chunk); // ~ms per MB; incompressible by design
			controller.enqueue(chunk);
			sentChunks++;
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'application/octet-stream',
			'Content-Length': String(mb * CHUNK_BYTES),
			'Cache-Control': 'no-store'
		}
	});
};
