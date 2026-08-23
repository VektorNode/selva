/**
 * The app's store wiring. The wire contract itself — key namespacing and the
 * response snapshot — is covered in `@selvajs/server`; what needs pinning here
 * is that this app's singleton actually keys on what the contract produces.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { idempotencyKey, toStoredResponse, fromStoredResponse } from '@selvajs/server/compute';
import {
	withIdempotency,
	resetIdempotencyStore,
	idempotencyStoreSize
} from '../computeIdempotency.server.js';

afterEach(() => resetIdempotencyStore());

describe('withIdempotency', () => {
	it('runs once and replays thereafter, with the body intact', async () => {
		const build = async () =>
			toStoredResponse(new Response(JSON.stringify({ n: 1 }), { status: 200 }));

		const key = idempotencyKey('user-a', 'retry-1');
		const first = await withIdempotency(key, build);
		const second = await withIdempotency(key, build);

		expect(first.replayed).toBe(false);
		expect(second.replayed).toBe(true);
		expect(await fromStoredResponse(second.value, second.replayed).json()).toEqual({ n: 1 });
	});

	it('runs both callers when the client key matches but the caller differs', async () => {
		// The store has to distinguish them; a key that dropped the caller would
		// make this replay across tenants and `runs` would be 1.
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
});
