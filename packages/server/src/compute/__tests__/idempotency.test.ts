/**
 * The store's job is absorbing client retries, so the properties that matter are
 * about *concurrency and failure*, not hit rate:
 *
 *   - a retry arriving while the first solve is still running must join it, not
 *     start a second solve (the common case — clients retry on timeout);
 *   - a failed solve must be retryable, not replayed as a cached error for the
 *     whole TTL;
 *   - an expired entry must re-run, or the store becomes a result cache and
 *     serves stale geometry after a version pointer moves.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createIdempotencyStore } from '../idempotency.js';

afterEach(() => vi.useRealTimers());

/** A promise plus its resolvers, for holding a "solve" open mid-flight. */
function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe('createIdempotencyStore', () => {
	it('replays a completed result instead of re-running', async () => {
		const store = createIdempotencyStore<number>({ ttlMs: 60_000 });
		const fn = vi.fn(async () => 42);

		const first = await store.run('k', fn);
		const second = await store.run('k', fn);

		expect(first).toEqual({ value: 42, replayed: false });
		expect(second).toEqual({ value: 42, replayed: true });
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('joins an in-flight run rather than starting a second one', async () => {
		const store = createIdempotencyStore<string>({ ttlMs: 60_000 });
		const gate = deferred<string>();
		const fn = vi.fn(() => gate.promise);

		const a = store.run('k', fn);
		const b = store.run('k', fn);
		// Both are pending on the SAME call — this is the retry-during-solve case.
		expect(fn).toHaveBeenCalledTimes(1);

		gate.resolve('done');
		expect(await a).toEqual({ value: 'done', replayed: false });
		expect(await b).toEqual({ value: 'done', replayed: true });
	});

	it('does not replay a failure — the next attempt re-runs', async () => {
		const store = createIdempotencyStore<string>({ ttlMs: 60_000 });
		const fn = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(new Error('compute down'))
			.mockResolvedValueOnce('ok');

		await expect(store.run('k', fn)).rejects.toThrow('compute down');
		// A cached error would make the client's retry pointless for the whole TTL.
		expect(await store.run('k', fn)).toEqual({ value: 'ok', replayed: false });
		expect(fn).toHaveBeenCalledTimes(2);
		expect(store.size()).toBe(1);
	});

	it('re-runs after the TTL expires', async () => {
		vi.useFakeTimers();
		const store = createIdempotencyStore<number>({ ttlMs: 1_000 });
		const fn = vi.fn(async () => 1);

		await store.run('k', fn);
		vi.advanceTimersByTime(1_001);
		const again = await store.run('k', fn);

		expect(again.replayed).toBe(false);
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it('keeps different keys independent', async () => {
		const store = createIdempotencyStore<string>({ ttlMs: 60_000 });
		expect((await store.run('a', async () => 'A')).value).toBe('A');
		// The route namespaces by caller, so this is what stops one tenant
		// replaying another's result under the same client-chosen key.
		expect((await store.run('b', async () => 'B')).value).toBe('B');
		expect(store.size()).toBe(2);
	});

	it('never evicts an in-flight entry to satisfy the cap', async () => {
		vi.useFakeTimers();
		const store = createIdempotencyStore<string>({ ttlMs: 1_000, maxKeys: 1 });
		const gate = deferred<string>();

		const inFlight = store.run('slow', () => gate.promise);
		// Push past the cap while `slow` is still running. Evicting it would orphan
		// the retries already awaiting it.
		vi.advanceTimersByTime(2_000);
		await store.run('other', async () => 'x');

		gate.resolve('finished');
		expect(await inFlight).toEqual({ value: 'finished', replayed: false });
	});

	it('sweeps expired entries so the map does not grow without bound', async () => {
		vi.useFakeTimers();
		const store = createIdempotencyStore<number>({ ttlMs: 1_000 });

		for (let i = 0; i < 5; i++) await store.run(`k${i}`, async () => i);
		expect(store.size()).toBe(5);

		vi.advanceTimersByTime(1_001);
		await store.run('fresh', async () => 0);

		// The five dead entries went; only `fresh` remains.
		expect(store.size()).toBe(1);
	});
});
