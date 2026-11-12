import { KEEPALIVE_PREFERENCE, type KeepaliveMeta } from '../shared/keepalive.js';

export const KEEPALIVE_REQUEST_HEADERS = { Prefer: KEEPALIVE_PREFERENCE } as const;

// ArrayBuffer-backed, as `Response.body` yields: DecompressionStream takes no SharedArrayBuffer.
type Bytes = Uint8Array<ArrayBuffer>;

const NEWLINE = 0x0a;
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/**
 * The real response inside a keep-alive stream (wire format in `shared/keepalive.ts`), or `res`
 * itself when the server didn't apply the preference. Resolves once the solve's response begins,
 * so it waits as long as the solve.
 *
 * @throws when the stream ends or breaks before the real response begins.
 */
export async function unwrapKeepalive(res: Response): Promise<Response> {
	if (res.headers.get('Preference-Applied') !== KEEPALIVE_PREFERENCE || !res.body) return res;

	const reader = res.body.getReader();
	let head: Bytes = new Uint8Array(0);
	for (;;) {
		const { done, value } = await reader.read();
		if (done) throw new Error('The keep-alive response ended before the solve result.');
		head = concat(head, value);
		const newline = head.indexOf(NEWLINE);
		if (newline === -1) continue;

		// JSON.parse skips the leading keep-alive spaces.
		const meta = JSON.parse(new TextDecoder().decode(head.subarray(0, newline))) as KeepaliveMeta;
		const headers = new Headers(meta.headers);
		let body = prepend(head.subarray(newline + 1), reader);
		// The outer response had no Content-Encoding, so fetch left the inner body compressed.
		if (headers.get('Content-Encoding') === 'gzip') {
			body = body.pipeThrough(new DecompressionStream('gzip'));
			headers.delete('Content-Encoding');
			headers.delete('Content-Length');
		}
		return new Response(NULL_BODY_STATUSES.has(meta.status) ? null : body, {
			status: meta.status,
			headers
		});
	}
}

function concat(a: Bytes, b: Bytes): Bytes {
	const out = new Uint8Array(a.byteLength + b.byteLength);
	out.set(a);
	out.set(b, a.byteLength);
	return out;
}

/** `first`, then the rest of `reader`. */
function prepend(first: Bytes, reader: ReadableStreamDefaultReader<Bytes>): ReadableStream<Bytes> {
	return new ReadableStream<Bytes>({
		start(controller) {
			if (first.byteLength > 0) controller.enqueue(first);
		},
		async pull(controller) {
			const { done, value } = await reader.read();
			if (done) controller.close();
			else controller.enqueue(value);
		},
		cancel(reason) {
			return reader.cancel(reason);
		}
	});
}
