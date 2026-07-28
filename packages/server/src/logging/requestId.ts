/**
 * Request-id resolution for log correlation.
 *
 * Every log record on a request path carries the same `requestId`, so an
 * operator handed one id can reconstruct that request's whole story — which is
 * the thing 199 uncorrelated `console.*` calls could never offer.
 *
 * Inbound ids are TRUSTED when present. Selva is documented as running behind a
 * reverse proxy (Caddy/nginx), and those proxies mint a request id for their own
 * access logs; generating a second one here would split a single request across
 * two ids and make cross-tier correlation impossible. The trade is that a direct
 * caller can choose their own id — acceptable, because a request id is a
 * correlation hint, never an authorization or uniqueness input. It is used only
 * as a log field and an echoed response header.
 *
 * That trust is exactly why {@link sanitizeRequestId} exists: an attacker-chosen
 * id is untrusted *content*. Unbounded or newline-carrying values would let a
 * caller forge log lines (log injection) or bloat every record on the request.
 */

/** Header carrying a caller/proxy-supplied id. The de-facto standard spelling. */
export const REQUEST_ID_HEADER = 'x-request-id';

/** Max retained length. Long enough for a UUID or a W3C trace-id, short enough to bound a record. */
const MAX_REQUEST_ID_LENGTH = 128;

/**
 * Characters allowed through verbatim. Deliberately strict: UUIDs, ULIDs, hex
 * trace-ids and nginx's `$request_id` all fit. Anything else (whitespace,
 * control chars, quotes, CR/LF) is dropped rather than escaped — there is no
 * legitimate id that needs them, and dropping can't be un-escaped downstream.
 */
const UNSAFE_REQUEST_ID_CHARS = /[^A-Za-z0-9._:-]/g;

/**
 * Reduce an untrusted inbound id to something safe to stamp on every record.
 * Returns `null` when nothing usable survives, so the caller generates instead.
 */
export function sanitizeRequestId(raw: string | null | undefined): string | null {
	if (!raw) return null;
	const cleaned = raw.replace(UNSAFE_REQUEST_ID_CHARS, '').slice(0, MAX_REQUEST_ID_LENGTH);
	return cleaned.length > 0 ? cleaned : null;
}

/**
 * Resolve the id for a request: reuse the proxy's when it survives
 * sanitization, otherwise mint a fresh UUID.
 *
 * @param headers the inbound request headers
 * @param generate id source; injectable so tests get deterministic ids
 */
export function resolveRequestId(headers: Headers, generate: () => string = randomId): string {
	return sanitizeRequestId(headers.get(REQUEST_ID_HEADER)) ?? generate();
}

/**
 * Render a thrown value into a log field.
 *
 * Not every rejection is an `Error` — provider adapters occasionally reject with
 * a plain `{ message, status }` object, which would otherwise stringify to a
 * useless `[object Object]` and destroy the only record of the failure. Errors
 * keep their stack (that's the diagnostic); anything else is JSON-serialized,
 * with `String()` as the last resort for cycles and exotic values.
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
 * `crypto.randomUUID` is available in every runtime Selva targets (Node 22+,
 * workers, modern browsers). The fallback covers non-secure contexts where
 * `randomUUID` is missing — ids only need to be collision-free enough to
 * correlate logs, never unguessable.
 */
function randomId(): string {
	const c: Crypto | undefined = globalThis.crypto;
	if (c && typeof c.randomUUID === 'function') return c.randomUUID();
	return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
