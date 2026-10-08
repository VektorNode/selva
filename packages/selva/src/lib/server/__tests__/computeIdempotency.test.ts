/**
 * The app's store wiring. The wire contract itself is covered in
 * `@selvajs/server`; what needs pinning here is that this app's singleton
 * keys on what the contract produces.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { runIdempotent } from '@selvajs/server/api';
import {
	solveIdempotencyStore,
	resetIdempotencyStore,
	idempotencyStoreSize
} from '../computeIdempotency.server.js';

afterEach(() => resetIdempotencyStore());

const call = (callerId: string, clientKey: string, fn: () => Promise<Response>) =>
	runIdempotent({ store: solveIdempotencyStore, callerId, clientKey, fingerprint: 'f' }, fn);

describe('solveIdempotencyStore', () => {
	it('runs once and replays thereafter, with the body intact', async () => {
		const build = async () => new Response(JSON.stringify({ n: 1 }), { status: 200 });

		const first = await call('user:a', 'retry-1', build);
		const second = await call('user:a', 'retry-1', build);

		expect(first.headers.get('Idempotency-Replayed')).toBeNull();
		expect(second.headers.get('Idempotency-Replayed')).toBe('true');
		expect(await second.json()).toEqual({ n: 1 });
	});

	it('runs both callers when the client key matches but the caller differs', async () => {
		// A key that dropped the caller would replay across tenants and `runs` would be 1.
		let runs = 0;
		const build = async () => {
			runs++;
			return new Response('x');
		};

		await call('user:a', 'same', build);
		await call('user:b', 'same', build);

		expect(runs).toBe(2);
		expect(idempotencyStoreSize()).toBe(2);
	});
});
