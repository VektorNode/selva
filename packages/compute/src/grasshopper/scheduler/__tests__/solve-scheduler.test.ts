import { describe, it, expect, vi } from 'vitest';
import { SolveScheduler } from '../solve-scheduler';
import type { SchedulerMode, SolveExecutor } from '../types';
import { ComputeError, ErrorCodes } from '@/core/errors';
import { setResponseWireSize } from '@/core/compute-fetch/wire-size';
import type { SolveDefinition } from '@/core/definition-ref';
import type {
	DataTree,
	GrasshopperComputeConfig,
	GrasshopperComputeResponse
} from '@/grasshopper/types';

const baseConfig: GrasshopperComputeConfig = {
	serverUrl: 'http://localhost:6500'
};

const tree = (name: string): DataTree => ({ ParamName: name, InnerTree: {} });

function makeResponse(tag: string): GrasshopperComputeResponse {
	return {
		algo: 'x',
		filename: tag,
		dataversion: 8,
		modelunits: 'Meters',
		cachesolve: false,
		values: []
	} as unknown as GrasshopperComputeResponse;
}

/**
 * Build an executor that resolves on demand. Returns the executor plus a
 * controller for releasing pending calls in test order.
 */
function deferredExecutor() {
	const queue: Array<{
		definition: SolveDefinition;
		dataTree: DataTree[];
		signal: AbortSignal | undefined;
		release: (response: GrasshopperComputeResponse) => void;
		fail: (error: Error) => void;
	}> = [];

	const executor: SolveExecutor = (definition, dataTree, _cacheKey, config) => {
		return new Promise((resolve, reject) => {
			const signal = config.signal;
			const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
			signal?.addEventListener('abort', onAbort, { once: true });

			queue.push({
				definition,
				dataTree,
				signal,
				release: (r) => {
					signal?.removeEventListener('abort', onAbort);
					resolve({ response: r, cacheKey: null, missed: false });
				},
				fail: (e) => {
					signal?.removeEventListener('abort', onAbort);
					reject(e);
				}
			});
		});
	};

	return { executor, queue };
}

describe('SolveScheduler', () => {
	describe('latest-wins mode', () => {
		it('runs a single solve to completion', async () => {
			const { executor, queue } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, { mode: 'latest-wins' });

			const promise = scheduler.solve('def', []);
			expect(scheduler.isSolving).toBe(true);
			expect(queue).toHaveLength(1);

			queue[0].release(makeResponse('a'));
			const result = await promise;
			expect(result.filename).toBe('a');
			expect(scheduler.isSolving).toBe(false);
			expect(scheduler.lastResult?.filename).toBe('a');
		});

		it('aborts in-flight when a new solve arrives', async () => {
			const { executor, queue } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, { mode: 'latest-wins' });

			const first = scheduler.solve('def', [tree('x')]);
			expect(queue).toHaveLength(1);

			const second = scheduler.solve('def', [tree('y')]);

			// First should reject as superseded; the in-flight is aborted via its signal
			await expect(first).rejects.toMatchObject({
				code: ErrorCodes.SUPERSEDED,
				message: expect.stringMatching(/Superseded/i)
			});

			// The aborted call rejects with AbortError → drainNext kicks in → second runs
			await vi.waitFor(() => expect(queue.length).toBeGreaterThanOrEqual(2));

			queue[1].release(makeResponse('b'));
			const r2 = await second;
			expect(r2.filename).toBe('b');
		});

		it('fires onSuperseded hook for cancelled calls', async () => {
			const { executor } = deferredExecutor();
			const onSuperseded = vi.fn();
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'latest-wins',
				onSuperseded
			});

			scheduler.solve('def', [tree('x')]).catch(() => {});
			scheduler.solve('def', [tree('y')]).catch(() => {});

			expect(onSuperseded).toHaveBeenCalledTimes(1);
		});

		it('does not fire an error onSettle for a superseded in-flight solve', async () => {
			const { executor, queue } = deferredExecutor();
			const onSettle = vi.fn();
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'latest-wins',
				onSettle
			});

			// First goes in-flight, then a newer call supersedes + aborts it.
			scheduler.solve('def', [tree('x')]).catch(() => {});
			const last = scheduler.solve('def', [tree('y')]);

			// Let the aborted first run its catch/finally, then complete the second.
			await vi.waitFor(() => expect(queue.length).toBe(2));
			queue[1].release(makeResponse('y'));
			await expect(last).resolves.toMatchObject({ filename: 'y' });

			// onSettle must fire exactly once (the success), never an error settle for
			// the superseded solve — that was the duplicate-hook bug.
			const errorSettles = onSettle.mock.calls.filter((c) => c[1]?.status === 'error');
			expect(errorSettles).toHaveLength(0);
			expect(onSettle).toHaveBeenCalledTimes(1);
		});

		it('only the latest survives when many solves race during abort window', async () => {
			const { executor, queue } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, { mode: 'latest-wins' });

			const promises: Promise<GrasshopperComputeResponse>[] = [];
			// Fire 10 solves back-to-back. Only the last should resolve; the rest
			// should reject (in-flight ones with SUPERSEDED, pendings with SUPERSEDED too).
			for (let i = 0; i < 10; i++) {
				promises.push(scheduler.solve('def', [tree(`p${i}`)]));
			}

			// All but the last should be settled as rejected (the last one is still pending/in-flight).
			const settled = await Promise.allSettled(promises.slice(0, 9));
			for (const s of settled) {
				expect(s.status).toBe('rejected');
				if (s.status === 'rejected') {
					expect((s.reason as ComputeError).code).toBe(ErrorCodes.SUPERSEDED);
				}
			}

			// Wait for whatever solve actually got executed (could be the last one if
			// the in-flight aborts have flushed) and release it.
			await vi.waitFor(() => expect(queue.length).toBeGreaterThanOrEqual(1));
			// Drain everything in the executor queue — we don't know how many made it
			// past the abort window but the LAST scheduler.solve must succeed.
			for (const q of queue) q.release(makeResponse('latest'));

			await expect(promises[9]).resolves.toMatchObject({ filename: 'latest' });
		});

		it('lastError reflects the original supersede cause, not the downstream abort', async () => {
			const { executor, queue } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, { mode: 'latest-wins' });

			scheduler.solve('def', [tree('x')]).catch(() => {});
			const second = scheduler.solve('def', [tree('y')]);

			// Wait for the aborted first to flush its finally and the second to run.
			await vi.waitFor(() => expect(queue.length).toBeGreaterThanOrEqual(2));

			// _lastError after the abort settles should be SUPERSEDED, not UNKNOWN_ERROR
			// (the executor's AbortError must not overwrite the supersede).
			expect(scheduler.lastError?.code).toBe(ErrorCodes.SUPERSEDED);

			queue[1].release(makeResponse('y'));
			await expect(second).resolves.toMatchObject({ filename: 'y' });
		});
	});

	describe('queue mode', () => {
		it.each([1, 2])('runs at most maxConcurrent=%i at once', async (maxConcurrent) => {
			const { executor, queue } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, { mode: 'queue', maxConcurrent });

			const solves = Array.from({ length: maxConcurrent + 1 }, (_, i) =>
				scheduler.solve('def', [tree(`p${i}`)])
			);

			expect(queue).toHaveLength(maxConcurrent);
			expect(scheduler.inFlightCount).toBe(maxConcurrent);
			expect(scheduler.queueDepth).toBe(1);

			queue[0].release(makeResponse('first'));
			await solves[0];

			await vi.waitFor(() => expect(queue.length).toBe(maxConcurrent + 1));
			queue.slice(1).forEach((call) => call.release(makeResponse('rest')));
			expect((await solves[maxConcurrent]).filename).toBe('rest');
		});
	});

	describe('backpressure (queue bounds)', () => {
		it('sheds the newest call with QUEUE_FULL when the queue is full', async () => {
			const { executor, queue } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'queue',
				maxConcurrent: 1,
				maxQueueDepth: 1
			});

			// a: in flight. b: fills the single queue slot. c: shed.
			const a = scheduler.solve('def', [tree('a')]);
			const b = scheduler.solve('def', [tree('b')]);
			const c = scheduler.solve('def', [tree('c')]);

			expect(scheduler.inFlightCount).toBe(1);
			expect(scheduler.queueDepth).toBe(1);

			await expect(c).rejects.toMatchObject({
				code: ErrorCodes.QUEUE_FULL,
				statusCode: 503,
				context: { queueDepth: 1, maxQueueDepth: 1 }
			});

			// a and b are untouched: already-accepted work keeps its place.
			queue[0].release(makeResponse('a'));
			expect((await a).filename).toBe('a');
			await vi.waitFor(() => expect(queue.length).toBe(2));
			queue[1].release(makeResponse('b'));
			expect((await b).filename).toBe('b');
		});

		it('treats maxQueueDepth as unbounded by default (no shedding)', async () => {
			const { executor } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'queue',
				maxConcurrent: 1
			});

			const promises = Array.from({ length: 5 }, (_, i) =>
				scheduler.solve('def', [tree(`p${i}`)]).catch((e) => e)
			);
			expect(scheduler.queueDepth).toBe(4);
			// None shed.
			scheduler.cancelAll();
			const results = await Promise.all(promises);
			expect(results.every((r) => r.code === ErrorCodes.ABORTED)).toBe(true);
		});

		it('does not apply backpressure in latest-wins mode', async () => {
			const { executor } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'latest-wins',
				maxQueueDepth: 1
			});

			const a = scheduler.solve('def', [tree('a')]).catch((e) => e);
			// A second call supersedes rather than being shed as QUEUE_FULL.
			const b = scheduler.solve('def', [tree('b')]).catch((e) => e);
			expect((await a).code).toBe(ErrorCodes.SUPERSEDED);
			scheduler.cancelAll();
			expect((await b).code).toBe(ErrorCodes.ABORTED);
		});

		it('sheds a call with QUEUE_TIMEOUT after queueWaitMs', async () => {
			vi.useFakeTimers();
			try {
				const { executor, queue } = deferredExecutor();
				const scheduler = new SolveScheduler(executor, baseConfig, {
					mode: 'queue',
					maxConcurrent: 1,
					queueWaitMs: 1000
				});

				const a = scheduler.solve('def', [tree('a')]);
				const b = scheduler.solve('def', [tree('b')]).catch((e) => e);

				expect(scheduler.queueDepth).toBe(1);

				// b waits past its deadline while a is still in flight.
				await vi.advanceTimersByTimeAsync(1001);

				const bErr = await b;
				expect(bErr.code).toBe(ErrorCodes.QUEUE_TIMEOUT);
				expect(bErr.statusCode).toBe(503);
				expect(bErr.context.queueWaitMs).toBe(1000);
				expect(scheduler.queueDepth).toBe(0);

				// a is unaffected.
				queue[0].release(makeResponse('a'));
				expect((await a).filename).toBe('a');
			} finally {
				vi.useRealTimers();
			}
		});

		it('clears the queue-wait timer once the item starts executing', async () => {
			vi.useFakeTimers();
			try {
				const { executor, queue } = deferredExecutor();
				const scheduler = new SolveScheduler(executor, baseConfig, {
					mode: 'queue',
					maxConcurrent: 1,
					queueWaitMs: 1000
				});

				const a = scheduler.solve('def', [tree('a')]);
				const b = scheduler.solve('def', [tree('b')]);

				// a finishes, b promotes to in-flight before its deadline.
				queue[0].release(makeResponse('a'));
				await a;
				await vi.waitFor(() => expect(queue.length).toBe(2));
				expect(scheduler.inFlightCount).toBe(1);

				// Advancing past the old deadline must NOT time b out — it's running.
				await vi.advanceTimersByTimeAsync(2000);
				queue[1].release(makeResponse('b'));
				expect((await b).filename).toBe('b');
			} finally {
				vi.useRealTimers();
			}
		});
	});

	describe('cancellation', () => {
		it('aborting a QUEUED solve rejects it and never executes it', async () => {
			const { executor, queue } = deferredExecutor();
			const onSettle = vi.fn();
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'queue',
				maxConcurrent: 1,
				onSettle
			});

			const a = scheduler.solve('def', [tree('a')]);
			const ctrlB = new AbortController();
			const b = scheduler.solve('def', [tree('b')], {
				signal: ctrlB.signal
			});
			expect(scheduler.queueDepth).toBe(1);

			ctrlB.abort(); // b is still queued — a holds the only slot

			await expect(b).rejects.toMatchObject({ code: ErrorCodes.ABORTED });
			expect(scheduler.queueDepth).toBe(0);
			// The aborted item settles like any other (no leaked "in progress" state).
			expect(onSettle.mock.calls.some((c) => c[1]?.status === 'error')).toBe(true);

			// Releasing a must NOT start b — it was dropped from the queue.
			queue[0].release(makeResponse('a'));
			await a;
			await new Promise((r) => setTimeout(r, 0));
			expect(queue).toHaveLength(1);
		});

		it('aborting the pending latest-wins item rejects it without executing', async () => {
			const { executor, queue } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, { mode: 'latest-wins' });

			const a = scheduler.solve('def', [tree('a')]);
			const ctrlB = new AbortController();
			const b = scheduler.solve('def', [tree('b')], {
				signal: ctrlB.signal
			});

			ctrlB.abort(); // b is pending behind the (superseded, still-flushing) a

			await expect(b).rejects.toMatchObject({ code: ErrorCodes.ABORTED });
			await expect(a).rejects.toMatchObject({ code: ErrorCodes.SUPERSEDED });
			// Only a ever reached the executor.
			await new Promise((r) => setTimeout(r, 0));
			expect(queue).toHaveLength(1);
		});

		// startedAt is a Date.now() timestamp; measuring it with performance.now() goes ~ -1.7e12.
		it('cancelAll reports a sane durationMs for in-flight items', async () => {
			const { executor } = deferredExecutor();
			const onSettle = vi.fn();
			const scheduler = new SolveScheduler(executor, baseConfig, { mode: 'queue', onSettle });

			scheduler.solve('def', [tree('a')]).catch(() => {});
			scheduler.cancelAll();

			const errorSettle = onSettle.mock.calls.find((c) => c[1]?.status === 'error');
			expect(errorSettle).toBeDefined();
			expect(errorSettle![1].durationMs).toBeGreaterThanOrEqual(0);
			expect(errorSettle![1].durationMs).toBeLessThan(60_000);
		});

		it('a late rejection from a cancelled solve does not clobber newer state', async () => {
			// Deliberately ignores the abort signal, like a transport that only
			// notices the cancel when its socket errors much later.
			const pending: Array<{
				release: (r: GrasshopperComputeResponse) => void;
				fail: (e: Error) => void;
			}> = [];
			const executor: SolveExecutor = () =>
				new Promise((resolve, reject) =>
					pending.push({
						release: (response) => resolve({ response, cacheKey: null, missed: false }),
						fail: reject
					})
				);
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'queue',
				maxConcurrent: 2
			});

			// A: in flight, then cancelled — its executor promise stays pending.
			const a = scheduler.solve('def', [tree('a')]);
			scheduler.cancelAll();
			await expect(a).rejects.toMatchObject({ code: ErrorCodes.ABORTED });

			// C: a fresh solve succeeds.
			const c = scheduler.solve('def', [tree('c')]);
			await vi.waitFor(() => expect(pending.length).toBe(2));
			pending[1].release(makeResponse('c'));
			await c;
			expect(scheduler.lastError).toBeNull();

			// A's transport error finally lands — newer state must survive.
			pending[0].fail(new Error('late transport failure'));
			await new Promise((r) => setTimeout(r, 0));
			expect(scheduler.lastError).toBeNull();
			expect(scheduler.lastResult?.filename).toBe('c');
		});

		it('per-call signal aborts only that call', async () => {
			const { executor, queue } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'queue',
				maxConcurrent: 2
			});

			const ctrlA = new AbortController();
			const a = scheduler.solve('def', [tree('a')], {
				signal: ctrlA.signal
			});
			const b = scheduler.solve('def', [tree('b')]);

			ctrlA.abort();
			await expect(a).rejects.toMatchObject({ code: ErrorCodes.ABORTED });

			// b should still be in flight
			expect(scheduler.inFlightCount).toBe(1);
			queue[1].release(makeResponse('b'));
			await expect(b).resolves.toMatchObject({ filename: 'b' });
		});
	});

	describe('cache', () => {
		it('drops an expired entry on read, counting a miss and releasing its bytes', async () => {
			const { executor, queue } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'queue',
				cache: { ttlMs: 10, maxBytes: 1000 }
			});

			const inputs = [tree('x')];
			const first = scheduler.solve('def', inputs);
			const response = makeResponse('one');
			setResponseWireSize(response, 100);
			queue[0].release(response);
			await first;
			expect(scheduler.cacheStats()).toMatchObject({ entries: 1, bytes: 100 });

			await new Promise((r) => setTimeout(r, 20));
			const second = scheduler.solve('def', inputs);
			// The solve ran again, so this is a miss, whatever the reason the entry was gone.
			expect(scheduler.cacheStats()).toMatchObject({ entries: 0, bytes: 0, hits: 0, misses: 2 });
			await vi.waitFor(() => expect(queue.length).toBe(2));
			queue[1].release(makeResponse('two'));
			expect((await second).filename).toBe('two');
		});

		it('evicts LRU when retained bytes exceed maxBytes', async () => {
			const { executor, queue } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'queue',
				cache: { maxBytes: 250 }
			});

			const trees = ['a', 'b', 'c'].map((n) => [tree(n)]);
			for (let i = 0; i < 3; i++) {
				const p = scheduler.solve('def', trees[i]);
				await vi.waitFor(() => expect(queue.length).toBe(i + 1));
				const response = makeResponse(String(i + 1));
				setResponseWireSize(response, 100);
				queue[i].release(response);
				await p;
			}

			// 3 × 100 bytes > 250 → the oldest entry was evicted.
			expect(scheduler.cacheStats()).toMatchObject({ entries: 2, bytes: 200, evictions: 1 });
			const recheck = scheduler.solve('def', trees[0]);
			await vi.waitFor(() => expect(queue.length).toBe(4));
			queue[3].release(makeResponse('1-again'));
			expect((await recheck).filename).toBe('1-again');

			// The two newer entries survived — served without the executor.
			expect((await scheduler.solve('def', trees[2])).filename).toBe('3');
		});

		it('never retains a single response larger than the whole byte budget', async () => {
			const { executor, queue } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'queue',
				cache: { maxBytes: 500 }
			});

			const inputs = [tree('x')];
			const first = scheduler.solve('def', inputs);
			const oversized = makeResponse('big');
			setResponseWireSize(oversized, 1000);
			queue[0].release(oversized);
			expect((await first).filename).toBe('big'); // served through…

			expect(scheduler.cacheStats()).toMatchObject({ entries: 0, bytes: 0 }); // …never retained
			const second = scheduler.solve('def', inputs);
			await vi.waitFor(() => expect(queue.length).toBe(2));
			queue[1].release(makeResponse('big-again'));
			expect((await second).filename).toBe('big-again');
		});

		it('sizes a response without a wire-size hint via the stringify fallback', async () => {
			const { executor, queue } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'queue',
				cache: { maxBytes: 10 } // smaller than any stringified makeResponse
			});

			const inputs = [tree('x')];
			const first = scheduler.solve('def', inputs);
			queue[0].release(makeResponse('one')); // no hint → stringify fallback → oversized
			await first;

			expect(scheduler.cacheStats().entries).toBe(0);
		});

		// The counters behind the operator-facing hit rate. Without these the
		// admin panel could report a confident number that means nothing.
		describe('hit/miss counters', () => {
			it('counts a cold solve as a miss and its repeat as a hit', async () => {
				const { executor, queue } = deferredExecutor();
				const scheduler = new SolveScheduler(executor, baseConfig, {
					mode: 'queue',
					cache: { maxBytes: 100_000 }
				});
				const inputs = [tree('x')];

				const first = scheduler.solve('def', inputs);
				await vi.waitFor(() => expect(queue.length).toBe(1));
				queue[0].release(makeResponse('one'));
				await first;
				expect(scheduler.cacheStats()).toMatchObject({ hits: 0, misses: 1 });

				const second = await scheduler.solve('def', inputs); // served from cache
				expect(second.filename).toBe('one');
				expect(queue).toHaveLength(1);
				expect(scheduler.cacheStats()).toMatchObject({ hits: 1, misses: 1 });
			});

			it('keeps counters across clearCache so a hit rate stays comparable', async () => {
				const { executor, queue } = deferredExecutor();
				const scheduler = new SolveScheduler(executor, baseConfig, {
					mode: 'queue',
					cache: { maxBytes: 100_000 }
				});
				const inputs = [tree('x')];

				const first = scheduler.solve('def', inputs);
				await vi.waitFor(() => expect(queue.length).toBe(1));
				queue[0].release(makeResponse('one'));
				await first;

				scheduler.clearCache();
				expect(scheduler.cacheStats()).toMatchObject({ entries: 0, bytes: 0, misses: 1 });
			});
		});

		it('latest-wins: a cache hit supersedes the older in-flight solve', async () => {
			const { executor, queue } = deferredExecutor();
			const onSettle = vi.fn();
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'latest-wins',
				cache: { maxBytes: 100_000 },
				onSettle
			});

			// Prime the cache with input X.
			const treeX = [tree('x')];
			const prime = scheduler.solve('def', treeX);
			queue[0].release(makeResponse('x-cached'));
			await prime;

			// Y goes in flight, then X arrives and hits the cache.
			const treeY = [tree('y')];
			const y = scheduler.solve('def', treeY);
			await vi.waitFor(() => expect(queue.length).toBe(2));
			const x = await scheduler.solve('def', treeX);
			expect(x.filename).toBe('x-cached');

			// Y was superseded — its later completion must not overwrite the hit.
			await expect(y).rejects.toMatchObject({ code: ErrorCodes.SUPERSEDED });
			queue[1].release(makeResponse('y-stale'));
			await new Promise((r) => setTimeout(r, 0));
			expect(scheduler.lastResult?.filename).toBe('x-cached');
			const successSettles = onSettle.mock.calls.filter((c) => c[1]?.status === 'success');
			expect(successSettles.map((c) => c[1].response.filename)).toEqual(['x-cached', 'x-cached']);
		});

		it('an already-aborted signal rejects ABORTED, even on a cache hit', async () => {
			const { executor, queue } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'queue',
				cache: { maxBytes: 100_000 }
			});
			const inputs = [tree('x')];
			const ctrl = new AbortController();
			ctrl.abort();
			const solveAborted = () => scheduler.solve('def', inputs, { signal: ctrl.signal });

			await expect(solveAborted()).rejects.toMatchObject({ code: ErrorCodes.ABORTED });

			const prime = scheduler.solve('def', inputs);
			queue[0].release(makeResponse('cached'));
			await prime;

			await expect(solveAborted()).rejects.toMatchObject({ code: ErrorCodes.ABORTED });
			expect(queue).toHaveLength(1);
		});

		// An errored solve is a valid, deterministic GH result.
		it('caches responses with GH errors by default', async () => {
			const { executor, queue } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'queue',
				cache: { maxBytes: 100_000 }
			});

			const inputs = [tree('x')];
			const errored = { ...makeResponse('errored'), errors: ['guard tripped'] };

			const first = scheduler.solve('def', inputs);
			queue[0].release(errored);
			await first;

			const second = await scheduler.solve('def', inputs);
			expect(second.errors).toEqual(['guard tripped']);
			expect(queue).toHaveLength(1); // served from cache
		});

		it('skips caching errored solves when cacheErroredSolves is false', async () => {
			const { executor, queue } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'queue',
				cache: { cacheErroredSolves: false, maxBytes: 100_000 }
			});

			const inputs = [tree('x')];

			const first = scheduler.solve('def', inputs);
			queue[0].release({ ...makeResponse('errored'), errors: ['guard tripped'] });
			await first;

			// Not cached — the identical input executes again...
			const secondPromise = scheduler.solve('def', inputs);
			await vi.waitFor(() => expect(queue.length).toBe(2));
			queue[1].release(makeResponse('clean'));
			await secondPromise;

			// ...while error-free responses still cache normally.
			const third = await scheduler.solve('def', inputs);
			expect(third.filename).toBe('clean');
			expect(queue).toHaveLength(2);
		});

		it('recognizes PascalCase `Errors` (stock mcneel casing) for cacheErroredSolves', async () => {
			const { executor, queue } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'queue',
				cache: { cacheErroredSolves: false, maxBytes: 100_000 }
			});

			const inputs = [tree('x')];

			const first = scheduler.solve('def', inputs);
			queue[0].release({
				...makeResponse('errored'),
				Errors: ['guard tripped']
			} as GrasshopperComputeResponse);
			await first;

			// Not cached — the identical input executes again.
			const secondPromise = scheduler.solve('def', inputs);
			await vi.waitFor(() => expect(queue.length).toBe(2));
			queue[1].release(makeResponse('clean'));
			await secondPromise;
		});

		it('never caches a solve the plugin aborted', async () => {
			const { executor, queue } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'queue',
				cache: { maxBytes: 100_000 }
			});

			const inputs = [tree('x')];

			const first = scheduler.solve('def', inputs);
			queue[0].release({
				...makeResponse('aborted'),
				selva: { outcome: { aborted: true, blocked: false } }
			});
			await first;

			const secondPromise = scheduler.solve('def', inputs);
			await vi.waitFor(() => expect(queue.length).toBe(2));
			queue[1].release(makeResponse('clean'));
			expect((await secondPromise).filename).toBe('clean');
		});
	});

	describe('observability', () => {
		it('notifies subscribers of each state change', async () => {
			const { executor, queue } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig);
			const solving: boolean[] = [];
			scheduler.subscribe(() => solving.push(scheduler.isSolving));

			const p = scheduler.solve('def', []);
			expect(solving.at(-1)).toBe(true);

			queue[0].release(makeResponse('x'));
			await p;
			await vi.waitFor(() => expect(solving.at(-1)).toBe(false));
		});

		it('records the outcome and fires onStart and onSettle', async () => {
			const { executor, queue } = deferredExecutor();
			const onStart = vi.fn();
			const onSettle = vi.fn();
			const scheduler = new SolveScheduler(executor, baseConfig, { onStart, onSettle });

			const ok = scheduler.solve('def', []);
			expect(onStart).toHaveBeenCalledTimes(1);

			queue[0].release(makeResponse('ok'));
			await ok;

			expect(onSettle).toHaveBeenCalledTimes(1);
			expect(onSettle.mock.calls[0][1]).toMatchObject({ status: 'success', fromCache: false });
			expect(scheduler.lastResult?.filename).toBe('ok');
			expect(scheduler.lastDurationMs).toBeGreaterThanOrEqual(0);
			expect(scheduler.lastError).toBeNull();

			const failing = scheduler.solve('def', [tree('fail')]);
			queue[1].fail(new Error('boom'));
			await expect(failing).rejects.toBeInstanceOf(ComputeError);
			expect(scheduler.lastError).toBeInstanceOf(ComputeError);
		});
	});

	describe('mode validation', () => {
		it('rejects an unknown mode with INVALID_CONFIG', () => {
			const { executor } = deferredExecutor();
			expect(
				() =>
					new SolveScheduler(executor, baseConfig, {
						mode: 'parallel' as unknown as SchedulerMode
					})
			).toThrowError(expect.objectContaining({ code: ErrorCodes.INVALID_CONFIG }));
		});
	});

	describe('solveDetailed', () => {
		it('reports a server solve, then a cache hit for the same input', async () => {
			const { executor, queue } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'queue',
				cache: { maxBytes: 1024 * 1024 }
			});

			const first = scheduler.solveDetailed('def', [tree('a')]);
			queue[0].release(makeResponse('a'));
			const miss = await first;
			expect(miss).toMatchObject({ fromCache: false, definitionReuploaded: false });
			expect(miss.response.filename).toBe('a');
			expect(miss.durationMs).toBeGreaterThanOrEqual(0);

			const hit = await scheduler.solveDetailed('def', [tree('a')]);
			expect(hit).toEqual({ response: miss.response, fromCache: true, durationMs: 0 });
			expect(queue).toHaveLength(1);
		});
	});

	describe('per-call onServerTiming', () => {
		/** Fires `config.onServerTiming` with a timing tagged by call order, swallowing a throw like the fetch layer. */
		function timingExecutor() {
			let n = 0;
			const releases: Array<() => void> = [];
			const executor: SolveExecutor = (_def, _tree, _cacheKey, config) => {
				const call = ++n;
				return new Promise((resolve) => {
					releases.push(() => {
						try {
							config.onServerTiming?.({ solve: call, raw: `solve;dur=${call}` }, `req-${call}`);
						} catch {
							// swallowed, as in fireServerTiming
						}
						resolve({ response: makeResponse(`r${call}`), cacheKey: null, missed: false });
					});
				});
			};
			return { executor, releases };
		}

		it('gives each overlapping call its own timing, identical inputs included', async () => {
			const { executor, releases } = timingExecutor();
			const baseTiming = vi.fn();
			const scheduler = new SolveScheduler(
				executor,
				{ ...baseConfig, onServerTiming: baseTiming },
				{ mode: 'queue', maxConcurrent: 2 }
			);
			const timingA = vi.fn();
			const timingB = vi.fn();

			const a = scheduler.solveDetailed('def', [tree('x')], { onServerTiming: timingA });
			const b = scheduler.solveDetailed('def', [tree('x')], { onServerTiming: timingB });
			await vi.waitFor(() => expect(releases).toHaveLength(2));
			releases[1]();
			releases[0]();
			await Promise.all([a, b]);

			expect(timingA).toHaveBeenCalledExactlyOnceWith({ solve: 1, raw: 'solve;dur=1' }, 'req-1');
			expect(timingB).toHaveBeenCalledExactlyOnceWith({ solve: 2, raw: 'solve;dur=2' }, 'req-2');
			expect(baseTiming.mock.calls.map((c) => c[1])).toEqual(['req-2', 'req-1']);
		});

		it('still fires when the client-level callback throws', async () => {
			const { executor, releases } = timingExecutor();
			const scheduler = new SolveScheduler(
				executor,
				{
					...baseConfig,
					onServerTiming: () => {
						throw new Error('boom');
					}
				},
				{ mode: 'queue' }
			);
			const timing = vi.fn();

			const p = scheduler.solve('def', [tree('x')], { onServerTiming: timing });
			await vi.waitFor(() => expect(releases).toHaveLength(1));
			releases[0]();
			await p;
			expect(timing).toHaveBeenCalledOnce();
		});

		it('never fires for a fromCache hit', async () => {
			const { executor, releases } = timingExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'queue',
				cache: { maxBytes: 1024 * 1024 }
			});

			const first = scheduler.solve('def', [tree('x')]);
			await vi.waitFor(() => expect(releases).toHaveLength(1));
			releases[0]();
			await first;

			const timing = vi.fn();
			const hit = await scheduler.solveDetailed('def', [tree('x')], { onServerTiming: timing });
			expect(hit.fromCache).toBe(true);
			expect(timing).not.toHaveBeenCalled();
		});
	});

	describe('sessionId', () => {
		it('hands each solve its own id, and a cache hit, which sends nothing, ignores it', async () => {
			const sent: (string | undefined)[] = [];
			const executor: SolveExecutor = async (_def, _tree, _key, config) => {
				sent.push(config.sessionId);
				return { response: makeResponse('r'), cacheKey: null, missed: false };
			};
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'queue',
				maxConcurrent: 2,
				cache: { maxBytes: 1024 * 1024 }
			});

			await scheduler.solveDetailed('def', [tree('a')], { sessionId: 'alice' });
			await scheduler.solveDetailed('def', [tree('b')], { sessionId: 'bob' });
			await scheduler.solveDetailed('def', [tree('c')]);
			const hit = await scheduler.solveDetailed('def', [tree('a')], { sessionId: 'carol' });

			expect(sent).toEqual(['alice', 'bob', undefined]);
			expect(hit.fromCache).toBe(true);
		});

		it('rejects a malformed id before the solve takes a slot', async () => {
			const executor = vi.fn<SolveExecutor>();
			const onStart = vi.fn();
			const scheduler = new SolveScheduler(executor, baseConfig, { mode: 'queue', onStart });

			await expect(
				scheduler.solveDetailed('def', [tree('a')], { sessionId: 'has space' })
			).rejects.toMatchObject({ code: ErrorCodes.INVALID_CONFIG });
			expect(() => new SolveScheduler(executor, { ...baseConfig, sessionId: '' })).toThrow(
				expect.objectContaining({ code: ErrorCodes.INVALID_CONFIG })
			);
			expect(onStart).not.toHaveBeenCalled();
			expect(executor).not.toHaveBeenCalled();
		});
	});

	describe('per-solve headers', () => {
		it("replace the client config's of any casing, for that solve only", async () => {
			const sent: (Record<string, string> | undefined)[] = [];
			const executor: SolveExecutor = async (_def, _tree, _key, config) => {
				sent.push(config.headers);
				return { response: makeResponse('r'), cacheKey: null, missed: false };
			};
			const scheduler = new SolveScheduler(
				executor,
				{ ...baseConfig, headers: { 'X-Proxy': 'p', 'X-Selva-Definition': 'old' } },
				{ mode: 'queue' }
			);

			await scheduler.solveDetailed('def', [tree('a')], {
				headers: { 'x-selva-definition': 'new' }
			});
			await scheduler.solveDetailed('def', [tree('b')]);

			expect(sent).toEqual([
				{ 'X-Proxy': 'p', 'x-selva-definition': 'new' },
				{ 'X-Proxy': 'p', 'X-Selva-Definition': 'old' }
			]);
		});
	});

	describe('dispose', () => {
		it('cancels everything and rejects new calls', async () => {
			const { executor } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'queue',
				maxConcurrent: 1
			});

			const a = scheduler.solve('def', [tree('a')]);
			const b = scheduler.solve('def', [tree('b')]);

			scheduler.dispose();

			await expect(a).rejects.toBeInstanceOf(ComputeError);
			await expect(b).rejects.toBeInstanceOf(ComputeError);

			await expect(scheduler.solve('def', [])).rejects.toMatchObject({
				code: ErrorCodes.INVALID_STATE
			});
		});
	});
});

describe('SolveScheduler — concurrency limit', () => {
	const noop: SolveExecutor = async () => ({
		response: makeResponse('r'),
		cacheKey: null,
		missed: false
	});

	it('rejects a NaN maxConcurrent, which would wedge the queue', () => {
		expect(
			() => new SolveScheduler(noop, baseConfig, { mode: 'queue', maxConcurrent: NaN })
		).toThrowError(expect.objectContaining({ code: ErrorCodes.INVALID_CONFIG }));
		const scheduler = new SolveScheduler(noop, baseConfig, { mode: 'queue' });
		expect(() => scheduler.setMaxConcurrent(NaN)).toThrowError(
			expect.objectContaining({ code: ErrorCodes.INVALID_CONFIG })
		);
	});

	it('setMaxConcurrent starts queued work when raised and clamps below 1', async () => {
		const release: (() => void)[] = [];
		const executor: SolveExecutor = () =>
			new Promise((resolve) => {
				release.push(() => resolve({ response: makeResponse('r'), cacheKey: null, missed: false }));
			});
		const scheduler = new SolveScheduler(executor, baseConfig, { mode: 'queue' });
		const solves = ['a', 'b', 'c', 'd'].map((d) => scheduler.solve(d, []));
		expect(scheduler.inFlightCount).toBe(1);

		// Raising by more than one with several queued must start all of them at once.
		scheduler.setMaxConcurrent(4);
		expect(scheduler.inFlightCount).toBe(4);

		scheduler.setMaxConcurrent(0);
		release.splice(0).forEach((settle) => settle());
		await Promise.all(solves);

		const after = [scheduler.solve('c', []), scheduler.solve('d', [])];
		expect(scheduler.inFlightCount).toBe(1);
		scheduler.cancelAll();
		await Promise.allSettled(after);
	});
});

describe('SolveScheduler — dispose', () => {
	it('leaves the cache empty when an executor resolves after dispose', async () => {
		let finish!: () => void;
		const executor: SolveExecutor = () =>
			new Promise((resolve) => {
				finish = () => resolve({ response: makeResponse('late'), cacheKey: null, missed: false });
			});
		const scheduler = new SolveScheduler(executor, baseConfig, {
			mode: 'queue',
			cache: { maxBytes: 1_000_000 }
		});
		const solving = scheduler.solve('a', []);
		solving.catch(() => {});
		scheduler.dispose();
		finish();
		await expect(solving).rejects.toMatchObject({ code: ErrorCodes.ABORTED });
		await Promise.resolve();
		expect(scheduler.cacheStats().entries).toBe(0);
	});
});
