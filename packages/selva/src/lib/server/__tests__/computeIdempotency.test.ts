/**
 * The app-side idempotency binding. The store's own semantics are covered in
 * `@selvajs/server`; what needs pinning here is the wiring that makes it safe to
 * expose on a public endpoint:
 *
 *   - the key is namespaced by caller, so two tenants choosing the same
 *     `Idempotency-Key` never replay each other's solve result;
 *   - the response round-trips, because a `Response` body can only be read once
 *     and a naive store would replay an empty body.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
	idempotencyKey,
	withIdempotency,
	toStoredResponse,
	fromStoredResponse,
	resetIdempotencyStore,
	idempotencyStoreSize
} from '../computeIdempotency.server.js';

afterEach(() => resetIdempotencyStore());

describe('idempotencyKey', () => {
	it('separates the same client key across two callers', () => {
		// The header is client-chosen — "retry-1" is a plausible collision.
		expect(idempotencyKey('user-a', 'retry-1')).not.toBe(idempotencyKey('user-b', 'retry-1'));
	});

	it('separates two client keys for one caller', () => {
		expect(idempotencyKey('user-a', 'k1')).not.toBe(idempotencyKey('user-a', 'k2'));
	});
});

describe('withIdempotency', () => {
	it('replays a stored response body rather than an empty one', async () => {
		const build = async () =>
			toStoredResponse(
				new Response(JSON.stringify({ ok: true, n: 1 }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
			);

		const key = idempotencyKey('user-a', 'retry-1');
		const first = await withIdempotency(key, build);
		const second = await withIdempotency(key, build);

		expect(first.replayed).toBe(false);
		expect(second.replayed).toBe(true);

		// The replay carries the same body — the trap a Response-valued store hits.
		const res = fromStoredResponse(second.value, second.replayed);
		expect(await res.json()).toEqual({ ok: true, n: 1 });
		expect(res.headers.get('content-type')).toBe('application/json');
		expect(res.headers.get('Idempotency-Replayed')).toBe('true');
	});

	it('does not mark a first response as a replay', async () => {
		const res = fromStoredResponse(await toStoredResponse(new Response('x')), false);
		expect(res.headers.get('Idempotency-Replayed')).toBeNull();
	});

	it('runs both callers when the client key matches but the caller differs', async () => {
		let runs = 0;
		const build = async () => {
			runs++;
			return toStoredResponse(new Response('x'));
		};

		await withIdempotency(idempotencyKey('user-a', 'same'), build);
		await withIdempotency(idempotencyKey('user-b', 'same'), build);

		expect(runs).toBe(2);
		expect(idempotencyStoreSize()).toBe(2);
	});

	it('preserves a non-2xx status on replay', async () => {
		const build = async () => toStoredResponse(new Response('nope', { status: 429 }));
		const key = idempotencyKey('user-a', 'k');

		await withIdempotency(key, build);
		const replay = await withIdempotency(key, build);

		expect(fromStoredResponse(replay.value, replay.replayed).status).toBe(429);
	});
});
