/**
 * The wire contract every host implementing `Idempotency-Key` has to agree on.
 *
 * Two properties, both of which fail silently when a host reinvents this:
 *
 *   - the key namespaces by caller, so two tenants choosing the same
 *     client-supplied key never replay each other's result;
 *   - the response round-trips through a snapshot, because a `Response` body
 *     reads exactly once and storing the object replays an empty body.
 */

import { describe, it, expect } from 'vitest';
import {
	idempotencyKey,
	toStoredResponse,
	fromStoredResponse,
	IDEMPOTENCY_REPLAYED_HEADER
} from '../idempotency-http.js';

describe('idempotencyKey', () => {
	it('separates the same client key across two callers', () => {
		// The header is client-chosen — "retry-1" is a plausible collision, and
		// without the caller in the key it is a cross-tenant replay.
		expect(idempotencyKey('user-a', 'retry-1')).not.toBe(idempotencyKey('user-b', 'retry-1'));
	});

	it('separates two client keys for one caller', () => {
		expect(idempotencyKey('user-a', 'k1')).not.toBe(idempotencyKey('user-a', 'k2'));
	});

	it('is stable for the same pair, or nothing would ever replay', () => {
		expect(idempotencyKey('user-a', 'k1')).toBe(idempotencyKey('user-a', 'k1'));
	});
});

describe('response snapshot', () => {
	it('round-trips a body that has already been read once', async () => {
		const stored = await toStoredResponse(
			new Response(JSON.stringify({ ok: true, n: 1 }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);

		// The trap a Response-valued store hits: the original body is spent, and
		// only the snapshot can still produce it.
		const res = fromStoredResponse(stored, true);
		expect(await res.json()).toEqual({ ok: true, n: 1 });
		expect(res.headers.get('content-type')).toBe('application/json');
	});

	it('marks a replay and leaves a fresh response unmarked', async () => {
		const stored = await toStoredResponse(new Response('x'));
		expect(fromStoredResponse(stored, true).headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBe('true');
		expect(fromStoredResponse(stored, false).headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBeNull();
	});

	it('preserves a non-2xx status', async () => {
		// A rate-limit refusal must replay as a refusal, not as a success.
		const stored = await toStoredResponse(new Response('nope', { status: 429 }));
		expect(fromStoredResponse(stored, true).status).toBe(429);
	});
});
