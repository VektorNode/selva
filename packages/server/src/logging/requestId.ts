/**
 * Request-id resolution for log correlation. Every record on a request path
 * carries the same `requestId`, so an operator handed one id can reconstruct
 * that request's whole story.
 *
 * Inbound ids are TRUSTED when present. Selva runs behind a reverse proxy
 * (Caddy/nginx) that mints a request id for its own access logs; minting a
 * second one here would split one request across two ids and kill cross-tier
 * correlation. The trade — a direct caller picks their own id — is fine, because
 * the id is only ever a log field and an echoed response header, never an
 * authorization or uniqueness input.
 *
 * That trust is why {@link sanitizeRequestId} exists: an attacker-chosen id is
 * untrusted content. Unbounded or newline-carrying values would let a caller
 * forge log lines (log injection) or bloat every record on the request.
 */

/** Header carrying a caller/proxy-supplied id. The de-facto standard spelling. */
export const REQUEST_ID_HEADER = 'x-request-id';

/** Long enough for a UUID or a W3C trace-id, short enough to bound a record. */
const MAX_REQUEST_ID_LENGTH = 128;

/**
 * Characters allowed through verbatim. Strict on purpose: UUIDs, ULIDs, hex
 * trace-ids and nginx's `$request_id` all fit. Everything else — whitespace,
 * control chars, quotes, CR/LF — is dropped rather than escaped, since no
 * legitimate id needs them and dropping can't be un-escaped downstream.
 */
const UNSAFE_REQUEST_ID_CHARS = /[^A-Za-z0-9._:-]/g;

/** Returns `null` when nothing usable survives, so the caller generates instead. */
export function sanitizeRequestId(raw: string | null | undefined): string | null {
	if (!raw) return null;
	const cleaned = raw.replace(UNSAFE_REQUEST_ID_CHARS, '').slice(0, MAX_REQUEST_ID_LENGTH);
	return cleaned.length > 0 ? cleaned : null;
}

/**
 * Reuse the proxy's id when it survives sanitization, otherwise mint a UUID.
 *
 * @param generate injectable so tests get deterministic ids
 */
export function resolveRequestId(headers: Headers, generate: () => string = randomId): string {
	return sanitizeRequestId(headers.get(REQUEST_ID_HEADER)) ?? generate();
}

/**
 * Render a thrown value into a log field.
 *
 * Not every rejection is an `Error` — provider adapters sometimes reject with a
 * plain `{ message, status }`, which would stringify to a useless
 * `[object Object]` and destroy the only record of the failure. Errors keep
 * their stack; anything else is JSON-serialized, with `String()` as the last
 * resort for cycles and exotic values.
 */
export function renderThrown(error: unknown): string {
	if (error instanceof Error) return error.stack ?? error.message;
	try {
		return JSON.stringify(error) ?? String(error);
	} catch {
		return String(error);
	}
}

/**
 * `crypto.randomUUID` exists in every runtime Selva targets (Node 22+, workers,
 * modern browsers); the `Math.random` branch only covers non-secure contexts
 * where it is missing. Not a weakness: these ids need to be collision-free
 * enough to correlate logs, never unguessable.
 */
function randomId(): string {
	const c: Crypto | undefined = globalThis.crypto;
	if (c && typeof c.randomUUID === 'function') return c.randomUUID();
	return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
