/**
 * `Idempotency-Key` for mounted routes that opt in with `idempotent: true`.
 *
 * Built on the solve route's store and wire contract (`../compute/idempotency*`):
 * the store absorbs in-flight and near-term retries in this process; it is not
 * a durable record. A create that must never duplicate also needs the key on
 * the created row under a unique constraint, written in the same transaction.
 *
 * Each entry carries a fingerprint of method, path and body, so a client that
 * reuses a key for a different request gets 422 instead of someone else's
 * replay. Only responses below 400 are kept: a failed attempt frees the key so
 * a corrected retry can run.
 */

import type { RequestContext } from '@selvajs/platform';
import { createIdempotencyStore, type IdempotencyStore } from '../compute/idempotency.js';
import {
	fromStoredResponse,
	idempotencyKey,
	toStoredResponse,
	type StoredResponse
} from '../compute/idempotency-http.js';
import { apiError, ApiErrorCode } from './errors.js';

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
export const MAX_IDEMPOTENCY_KEY_LENGTH = 255;
/** Covers a client's retry-on-timeout window without turning into a result cache. */
export const DEFAULT_API_IDEMPOTENCY_TTL_MS = 5 * 60_000;

export interface IdempotentEntry {
	fingerprint: string;
	response: StoredResponse;
}

export type ApiIdempotencyStore = IdempotencyStore<IdempotentEntry>;

export function createApiIdempotencyStore(
	ttlMs = DEFAULT_API_IDEMPOTENCY_TTL_MS
): ApiIdempotencyStore {
	return createIdempotencyStore<IdempotentEntry>({ ttlMs });
}

let sharedDefault: ApiIdempotencyStore | undefined;

/** The store `depsFromConfig` wires when the host passes none. One per process. */
export function defaultApiIdempotencyStore(): ApiIdempotencyStore {
	return (sharedDefault ??= createApiIdempotencyStore());
}

/**
 * The narrowest identity a key is namespaced by: the token for a token
 * request, so two keys of one user never share replays, else the user.
 */
export function idempotencyCallerId(ctx: RequestContext): string {
	return ctx.apiScope ? `token:${ctx.apiScope.tokenId}` : `user:${ctx.userId}`;
}

/** Read and validate the client's key. `null` when the header is absent. */
export function readIdempotencyKey(request: Request): string | null {
	const key = request.headers.get(IDEMPOTENCY_KEY_HEADER);
	if (key === null) return null;
	if (key.length === 0 || key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
		apiError(
			400,
			ApiErrorCode.VALIDATION_FAILED,
			`${IDEMPOTENCY_KEY_HEADER} must be 1 to ${MAX_IDEMPOTENCY_KEY_LENGTH} characters.`
		);
	}
	return key;
}

async function sha256Hex(bytes: BufferSource): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 over method, path and body, hex. */
export async function requestFingerprint(
	method: string,
	path: string,
	body: ArrayBuffer | string
): Promise<string> {
	const head = new TextEncoder().encode(`${method.toUpperCase()} ${path}\n`);
	const tail = typeof body === 'string' ? new TextEncoder().encode(body) : new Uint8Array(body);
	const bytes = new Uint8Array(head.length + tail.length);
	bytes.set(head);
	bytes.set(tail, head.length);
	return sha256Hex(bytes);
}

/**
 * The body `requestFingerprint` should hash, read from a clone so the handler
 * can still consume the original.
 *
 * Multipart is canonicalized to its fields and file contents: clients pick a
 * fresh random boundary per request, so the raw bytes of an identical retry
 * never match.
 */
export async function fingerprintBody(request: Request): Promise<ArrayBuffer | string> {
	const type = request.headers.get('content-type') ?? '';
	if (!type.toLowerCase().startsWith('multipart/form-data')) {
		return request.clone().arrayBuffer();
	}
	let form: FormData;
	try {
		form = await request.clone().formData();
	} catch {
		// Malformed: hash the raw bytes and let the handler refuse it.
		return request.clone().arrayBuffer();
	}
	const parts: [string, string | { file: string; type: string; sha256: string }][] = [];
	for (const [name, value] of form) {
		parts.push([
			name,
			typeof value === 'string'
				? value
				: { file: value.name, type: value.type, sha256: await sha256Hex(await value.arrayBuffer()) }
		]);
	}
	return JSON.stringify(parts);
}

class NotReplayable {
	constructor(
		readonly fingerprint: string,
		readonly response: StoredResponse
	) {}
}

function assertSameRequest(stored: string, fingerprint: string): void {
	if (stored !== fingerprint) {
		apiError(
			422,
			ApiErrorCode.UNPROCESSABLE,
			`This ${IDEMPOTENCY_KEY_HEADER} was already used for a different request.`
		);
	}
}

/**
 * Run `fn` once per `(callerId, clientKey)`, replaying its response to repeats
 * with `Idempotency-Replayed: true`. Throws 422 when the key was used for a
 * different request. Errors `fn` throws propagate and free the key.
 */
export async function runIdempotent(
	{
		store,
		callerId,
		clientKey,
		fingerprint
	}: { store: ApiIdempotencyStore; callerId: string; clientKey: string; fingerprint: string },
	fn: () => Promise<Response>
): Promise<Response> {
	let outcome;
	try {
		outcome = await store.run(idempotencyKey(callerId, clientKey), async () => {
			const res = await fn();
			const response = await toStoredResponse(res);
			if (res.status >= 400) throw new NotReplayable(fingerprint, response);
			return { fingerprint, response };
		});
	} catch (err) {
		if (!(err instanceof NotReplayable)) throw err;
		// A concurrent retry joining the failed attempt receives the same failure.
		assertSameRequest(err.fingerprint, fingerprint);
		return fromStoredResponse(err.response, false);
	}
	assertSameRequest(outcome.value.fingerprint, fingerprint);
	return fromStoredResponse(outcome.value.response, outcome.replayed);
}
