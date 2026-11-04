/**
 * `Idempotency-Key` for mounted routes that opt in with `idempotent: true`.
 *
 * Built on the generic store (`../compute/idempotency.ts`) and the wire
 * contract (`./idempotency-http.ts`). The store absorbs in-flight and near-term
 * retries in this process; it is not a durable record. A create that must never duplicate also needs the key on
 * the created row under a unique constraint, written in the same transaction.
 *
 * Each entry carries a fingerprint of method, path, query and body, so a client that
 * reuses a key for a different request gets 422 instead of someone else's
 * replay. Only responses below 400 are kept: a failed attempt frees the key so
 * a corrected retry can run.
 */

import { createHash } from 'node:crypto';
import type { RequestContext } from '@selvajs/platform';
import { createIdempotencyStore, type IdempotencyStore } from '../compute/idempotency.js';
import {
	fromStoredResponse,
	idempotencyKey,
	toStoredResponse,
	type StoredResponse
} from './idempotency-http.js';
import { apiError, ApiErrorCode } from './errors.js';
import { readForm } from './request.js';

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
export const MAX_IDEMPOTENCY_KEY_LENGTH = 255;
/** Covers a client's retry-on-timeout window without turning into a result cache. */
export const DEFAULT_API_IDEMPOTENCY_TTL_MS = 5 * 60_000;
/**
 * Replayable response bytes one store keeps. A solve response can run to
 * hundreds of MB, so the key cap alone would let a client that sends a fresh
 * key per solve hold gigabytes for the whole TTL. Evicting costs a re-run.
 */
export const DEFAULT_API_IDEMPOTENCY_MAX_BYTES = 256 * 1024 * 1024;

const CLIENT_CLOSED_REQUEST = 499;

export interface IdempotentEntry {
	fingerprint: string;
	response: StoredResponse;
}

export type ApiIdempotencyStore = IdempotencyStore<IdempotentEntry>;

export function createApiIdempotencyStore(
	ttlMs = DEFAULT_API_IDEMPOTENCY_TTL_MS,
	maxBytes = DEFAULT_API_IDEMPOTENCY_MAX_BYTES
): ApiIdempotencyStore {
	return createIdempotencyStore<IdempotentEntry>(
		{ ttlMs, maxWeight: maxBytes },
		(entry) => entry.response.body.byteLength
	);
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

/** SHA-256 over method, path with query, and body, hex. */
export async function requestFingerprint(
	method: string,
	url: URL,
	body: ArrayBuffer | string
): Promise<string> {
	const head = new TextEncoder().encode(`${method.toUpperCase()} ${url.pathname}${url.search}\n`);
	const tail = typeof body === 'string' ? new TextEncoder().encode(body) : new Uint8Array(body);
	const bytes = new Uint8Array(head.length + tail.length);
	bytes.set(head);
	bytes.set(tail, head.length);
	return sha256Hex(bytes);
}

async function fileSha256Hex(file: Blob): Promise<string> {
	const hash = createHash('sha256');
	for await (const chunk of file.stream()) hash.update(chunk);
	return hash.digest('hex');
}

/**
 * The body `requestFingerprint` should hash. The handler can still read it: a
 * JSON body comes from a clone, a form through `readForm`, which parses it once
 * for both.
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
		form = await readForm(request);
	} catch {
		// The handler's own read fails the same way, and a failure is never replayed.
		return 'malformed multipart';
	}
	const parts: [string, string | { file: string; type: string; sha256: string }][] = [];
	for (const [name, value] of form) {
		parts.push([
			name,
			typeof value === 'string'
				? value
				: { file: value.name, type: value.type, sha256: await fileSha256Hex(value) }
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
	let ranHere = false;
	try {
		outcome = await store.run(idempotencyKey(callerId, clientKey), async () => {
			ranHere = true;
			const res = await fn();
			const response = await toStoredResponse(res);
			if (res.status >= 400) throw new NotReplayable(fingerprint, response);
			return { fingerprint, response };
		});
	} catch (err) {
		if (!(err instanceof NotReplayable)) throw err;
		assertSameRequest(err.fingerprint, fingerprint);
		// 499 is the first client hanging up, which says nothing about this one:
		// its retry is the case the store exists for, so it runs on its own.
		if (!ranHere && err.response.status === CLIENT_CLOSED_REQUEST) {
			return runIdempotent({ store, callerId, clientKey, fingerprint }, fn);
		}
		// A concurrent retry joining the failed attempt receives the same failure.
		return fromStoredResponse(err.response, false);
	}
	assertSameRequest(outcome.value.fingerprint, fingerprint);
	return fromStoredResponse(outcome.value.response, outcome.replayed);
}
