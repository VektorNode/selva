import type { RequestHandler } from './$types';
import { randomFillSync } from 'node:crypto';
import { json } from '@sveltejs/kit';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { requirePermission } from '$lib/server/access.server';

/**
 * Network throughput probe for the /admin/system page. Measures the transport
 * path between the operator's browser and this server — through whatever
 * proxies/tunnels sit in between (reverse proxy, SSO relays such as Azure App
 * Proxy) — with zero compute involvement:
 *
 *   GET  ?mb=N  → streams N MB of random bytes (download direction)
 *   POST        → consumes and discards the request body, returns the
 *                 server-side receive duration (upload direction)
 *
 * Random bytes are deliberately incompressible so proxy compression can't fake
 * a fast transfer. `instance_admin` only — a bandwidth probe is an operator
 * tool, and the download side is a data faucet.
 *
 * A curl-friendly, env-flag-gated sibling exists at /api/diag/throughput for
 * shell-based testing (documented in docs/deployment/app-proxy-migration.md);
 * this endpoint is the browser/UI counterpart that also works behind SSO
 * proxies where curl can't authenticate.
 */

const CHUNK_BYTES = 1024 * 1024;
const DOWNLOAD_DEFAULT_MB = 20;
const DOWNLOAD_MAX_MB = 256;
const UPLOAD_MAX_BYTES = 256 * 1024 * 1024;

export const GET: RequestHandler = async ({ locals, url }) => {
	requirePermission(locals, 'instance_admin');

	const requested = Number(url.searchParams.get('mb'));
	const mb = Math.min(
		DOWNLOAD_MAX_MB,
		Math.max(1, Number.isFinite(requested) ? requested : DOWNLOAD_DEFAULT_MB)
	);

	// Pull-based stream: each pull waits for the socket to drain, so elapsed time
	// here ≈ the client's receive rate as seen FROM the server.
	let sentChunks = 0;
	const stream = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (sentChunks >= mb) {
				controller.close();
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

export const POST: RequestHandler = async ({ locals, request }) => {
	requirePermission(locals, 'instance_admin');

	// Reject a declared-oversized body before reading it.
	const declared = Number(request.headers.get('content-length'));
	if (Number.isFinite(declared) && declared > UPLOAD_MAX_BYTES) {
		apiError(413, ApiErrorCode.VALIDATION_FAILED, 'Upload exceeds the 256 MB probe limit');
	}

	if (!request.body) {
		apiError(400, ApiErrorCode.VALIDATION_FAILED, 'Missing request body');
	}

	// Stream-count and discard: memory stays flat regardless of upload size, and
	// the elapsed time is the server-side view of the upload (first byte already
	// arrived when the handler runs, so this measures body receive time).
	const start = performance.now();
	const reader = request.body.getReader();
	let bytes = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		bytes += value.byteLength;
		if (bytes > UPLOAD_MAX_BYTES) {
			await reader.cancel();
			apiError(413, ApiErrorCode.VALIDATION_FAILED, 'Upload exceeds the 256 MB probe limit');
		}
	}
	const ms = performance.now() - start;

	return json({
		bytes,
		ms: Math.round(ms),
		mbps: ms > 0 ? Number((bytes / (1024 * 1024) / (ms / 1000)).toFixed(2)) : null
	});
};
