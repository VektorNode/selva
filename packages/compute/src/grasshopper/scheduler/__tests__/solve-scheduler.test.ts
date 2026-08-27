import { describe, it, expect, vi } from 'vitest';
import { SolveScheduler, type SolveExecutor } from '../solve-scheduler';
import { ComputeError, ErrorCodes } from '@/core/errors';
import { setResponseWireSize } from '@/core/compute-fetch/wire-size';
import type { SolveDefinition } from '@/core/definition-ref';
import type { GrasshopperComputeConfig, GrasshopperComputeResponse } from '@/grasshopper/types';

const baseConfig: GrasshopperComputeConfig = {
	serverUrl: 'http://localhost:6500'
};

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
		dataTree: any[];
		signal: AbortSignal | undefined;
		release: (response: GrasshopperComputeResponse) => void;
		fail: (error: Error) => void;
	}> = [];

	const executor: SolveExecutor = (definition, dataTree, config) => {
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
					resolve(r);
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

			const first = scheduler.solve('def', [{ ParamName: 'x', InnerTree: {} } as any]);
			expect(queue).toHaveLength(1);

			const second = scheduler.solve('def', [{ ParamName: 'y', InnerTree: {} } as any]);

			// First should reject as superseded; the in-flight is aborted via its signal
			await expect(first).rejects.toMatchObject({ message: expect.stringMatching(/Superseded/i) });

			// The aborted call rejects with AbortError → drainNext kicks in → second runs
			await vi.waitFor(() => expect(queue.length).toBeGreaterThanOrEqual(2));

			queue[1].release(makeResponse('b'));
			const r2 = await second;
			expect(r2.filename).toBe('b');
		});

		it('supersedes pending when newer call arrives during in-flight', async () => {
			const { executor, queue } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, { mode: 'latest-wins' });

			const first = scheduler.solve('def', [{ ParamName: 'x', InnerTree: {} } as any]);
			const middle = scheduler.solve('def', [{ ParamName: 'y', InnerTree: {} } as any]);
			const last = scheduler.solve('def', [{ ParamName: 'z', InnerTree: {} } as any]);

			// Both first (in-flight, aborted) and middle (pending, superseded) reject
			await expect(first).rejects.toMatchObject({ code: expect.any(String) });
			await expect(middle).rejects.toMatchObject({ message: expect.stringMatching(/Superseded/i) });

			// `last` should run after the aborted first finishes its finally block
			await vi.waitFor(() => expect(queue.length).toBe(2));
			queue[1].release(makeResponse('z'));
			await expect(last).resolves.toMatchObject({ filename: 'z' });
		});

		it('fires onSuperseded hook for cancelled calls', async () => {
			const { executor } = deferredExecutor();
			const onSuperseded = vi.fn();
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'latest-wins',
				onSuperseded
			});

			scheduler.solve('def', [{ ParamName: 'x', InnerTree: {} } as any]).catch(() => {});
			scheduler.solve('def', [{ ParamName: 'y', InnerTree: {} } as any]).catch(() => {});

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
			scheduler.solve('def', [{ ParamName: 'x', InnerTree: {} } as any]).catch(() => {});
			const last = scheduler.solve('def', [{ ParamName: 'y', InnerTree: {} } as any]);

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

		it('rejects superseded calls with ErrorCodes.SUPERSEDED', async () => {
			const { executor } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, { mode: 'latest-wins' });

			const first = scheduler.solve('def', [{ ParamName: 'x', InnerTree: {} } as any]);
			scheduler.solve('def', [{ ParamName: 'y', InnerTree: {} } as any]).catch(() => {});

			await expect(first).rejects.toMatchObject({ code: ErrorCodes.SUPERSEDED });
		});

		it('only the latest survives when many solves race during abort window', async () => {
			const { executor, queue } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, { mode: 'latest-wins' });

			const promises: Promise<GrasshopperComputeResponse>[] = [];
			// Fire 10 solves back-to-back. Only the last should resolve; the rest
			// should reject (in-flight ones with SUPERSEDED, pendings with SUPERSEDED too).
			for (let i = 0; i < 10; i++) {
				promises.push(scheduler.solve('def', [{ ParamName: `p${i}`, InnerTree: {} } as any]));
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

		it('preserves SUPERSEDED code even when new solve arrives in the abort window', async () => {
			const { executor, queue } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, { mode: 'latest-wins' });

			const first = scheduler.solve('def', [{ ParamName: 'a', InnerTree: {} } as any]);

			// Second triggers abort of first — first.reject is called synchronously
			// with SUPERSEDED. The executor's catch later sees AbortError, but the
			// scheduler must NOT overwrite the rejection with an ABORTED code.
			const second = scheduler.solve('def', [{ ParamName: 'b', InnerTree: {} } as any]);

			// A third arrives during the abort window — second should also be SUPERSEDED.
			const third = scheduler.solve('def', [{ ParamName: 'c', InnerTree: {} } as any]);

			await expect(first).rejects.toMatchObject({ code: ErrorCodes.SUPERSEDED });
			await expect(second).rejects.toMatchObject({ code: ErrorCodes.SUPERSEDED });

			await vi.waitFor(() => expect(queue.length).toBeGreaterThanOrEqual(2));
			// Release whichever in-flight is left — third should resolve.
			for (const q of queue) q.release(makeResponse('c'));
			await expect(third).resolves.toMatchObject({ filename: 'c' });
		});

		it('lastError reflects the original supersede cause, not the downstream abort', async () => {
			const { executor, queue } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, { mode: 'latest-wins' });

			scheduler.solve('def', [{ ParamName: 'x', InnerTree: {} } as any]).catch(() => {});
			const second = scheduler.solve('def', [{ ParamName: 'y', InnerTree: {} } as any]);

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
		it('runs solves serially when maxConcurrent=1', async () => {
			const { executor, queue } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'queue',
				maxConcurrent: 1
			});

			const a = scheduler.solve('def', [{ ParamName: 'a', InnerTree: {} } as any]);
			const b = scheduler.solve('def', [{ ParamName: 'b', InnerTree: {} } as any]);

			// Only first should be in-flight
			expect(queue).toHaveLength(1);
			expect(scheduler.queueDepth).toBe(1);

			queue[0].release(makeResponse('a'));
			await a;

			await vi.waitFor(() => expect(queue.length).toBe(2));
			queue[1].release(makeResponse('b'));
			expect((await b).filename).toBe('b');
		});

		it('respects maxConcurrent', async () => {
			const { executor, queue } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'queue',
				maxConcurrent: 2
			});

			scheduler.solve('def', [{ ParamName: 'a', InnerTree: {} } as any]).catch(() => {});
			scheduler.solve('def', [{ ParamName: 'b', InnerTree: {} } as any]).catch(() => {});
			scheduler.solve('def', [{ ParamName: 'c', InnerTree: {} } as any]).catch(() => {});

			expect(queue).toHaveLength(2);
			expect(scheduler.inFlightCount).toBe(2);
			expect(scheduler.queueDepth).toBe(1);
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
			const a = scheduler.solve('def', [{ ParamName: 'a', InnerTree: {} } as any]);
			const b = scheduler.solve('def', [{ ParamName: 'b', InnerTree: {} } as any]);
			const c = scheduler.solve('def', [{ ParamName: 'c', InnerTree: {} } as any]);

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
				scheduler.solve('def', [{ ParamName: `p${i}`, InnerTree: {} } as any]).catch((e) => e)
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

			const a = scheduler.solve('def', [{ ParamName: 'a', InnerTree: {} } as any]).catch((e) => e);
			// A second call supersedes rather than being shed as QUEUE_FULL.
			const b = scheduler.solve('def', [{ ParamName: 'b', InnerTree: {} } as any]).catch((e) => e);
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

				const a = scheduler.solve('def', [{ ParamName: 'a', InnerTree: {} } as any]);
				const b = scheduler
					.solve('def', [{ ParamName: 'b', InnerTree: {} } as any])
					.catch((e) => e);

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

				const a = scheduler.solve('def', [{ ParamName: 'a', InnerTree: {} } as any]);
				const b = scheduler.solve('def', [{ ParamName: 'b', InnerTree: {} } as any]);

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
		it('cancelAll rejects pending and aborts in-flight', async () => {
			const { executor } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'queue',
				maxConcurrent: 1
			});

			const a = scheduler.solve('def', [{ ParamName: 'a', InnerTree: {} } as any]);
			const b = scheduler.solve('def', [{ ParamName: 'b', InnerTree: {} } as any]);

			scheduler.cancelAll();

			await expect(a).rejects.toBeInstanceOf(ComputeError);
			await expect(b).rejects.toMatchObject({ message: expect.stringMatching(/aborted/i) });
		});

		// Regression (issue 46): the external signal was only checked at solve()
		// entry and listened to in execute() — a signal firing while the item sat in
		// the queue was silently ignored, the item later ran a full compute, and the
		// promise resolved with a result instead of rejecting ABORTED.
		it('aborting a QUEUED solve rejects it and never executes it', async () => {
			const { executor, queue } = deferredExecutor();
			const onSettle = vi.fn();
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'queue',
				maxConcurrent: 1,
				onSettle
			});

			const a = scheduler.solve('def', [{ ParamName: 'a', InnerTree: {} } as any]);
			const ctrlB = new AbortController();
			const b = scheduler.solve('def', [{ ParamName: 'b', InnerTree: {} } as any], {
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

			const a = scheduler.solve('def', [{ ParamName: 'a', InnerTree: {} } as any]);
			const ctrlB = new AbortController();
			const b = scheduler.solve('def', [{ ParamName: 'b', InnerTree: {} } as any], {
				signal: ctrlB.signal
			});

			ctrlB.abort(); // b is pending behind the (superseded, still-flushing) a

			await expect(b).rejects.toMatchObject({ code: ErrorCodes.ABORTED });
			await expect(a).rejects.toMatchObject({ code: ErrorCodes.SUPERSEDED });
			// Only a ever reached the executor.
			await new Promise((r) => setTimeout(r, 0));
			expect(queue).toHaveLength(1);
		});

		// Regression (issue 51): startedAt is Date.now() but cancelAll measured
		// with performance.now() — durations were huge negative numbers (~ -1.7e12).
		it('cancelAll reports a sane durationMs for in-flight items', async () => {
			const { executor } = deferredExecutor();
			const onSettle = vi.fn();
			const scheduler = new SolveScheduler(executor, baseConfig, { mode: 'queue', onSettle });

			scheduler.solve('def', [{ ParamName: 'a', InnerTree: {} } as any]).catch(() => {});
			scheduler.cancelAll();

			const errorSettle = onSettle.mock.calls.find((c) => c[1]?.status === 'error');
			expect(errorSettle).toBeDefined();
			expect(errorSettle![1].durationMs).toBeGreaterThanOrEqual(0);
			expect(errorSettle![1].durationMs).toBeLessThan(60_000);
		});

		// Regression (issue 52): a cancelled solve's late executor rejection
		// overwrote _lastError even after a NEWER solve had already succeeded.
		it('a late rejection from a cancelled solve does not clobber newer state', async () => {
			// Deliberately ignores the abort signal, like a transport that only
			// notices the cancel when its socket errors much later.
			const pending: Array<{
				release: (r: GrasshopperComputeResponse) => void;
				fail: (e: Error) => void;
			}> = [];
			const executor: SolveExecutor = () =>
				new Promise((resolve, reject) => pending.push({ release: resolve, fail: reject }));
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'parallel',
				maxConcurrent: 2
			});

			// A: in flight, then cancelled — its executor promise stays pending.
			const a = scheduler.solve('def', [{ ParamName: 'a', InnerTree: {} } as any]);
			scheduler.cancelAll();
			await expect(a).rejects.toMatchObject({ code: ErrorCodes.ABORTED });

			// C: a fresh solve succeeds.
			const c = scheduler.solve('def', [{ ParamName: 'c', InnerTree: {} } as any]);
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
			const a = scheduler.solve('def', [{ ParamName: 'a', InnerTree: {} } as any], {
				signal: ctrlA.signal
			});
			const b = scheduler.solve('def', [{ ParamName: 'b', InnerTree: {} } as any]);

			ctrlA.abort();
			await expect(a).rejects.toBeInstanceOf(ComputeError);

			// b should still be in flight
			expect(scheduler.inFlightCount).toBe(1);
			queue[1].release(makeResponse('b'));
			await expect(b).resolves.toMatchObject({ filename: 'b' });
		});

		it('rejects immediately when caller signal is already aborted', async () => {
			const { executor } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig);
			const ctrl = new AbortController();
			ctrl.abort();
			await expect(scheduler.solve('def', [], { signal: ctrl.signal })).rejects.toMatchObject({
				code: ErrorCodes.ABORTED
			});
		});

		it('per-call signal aborts in-flight with ErrorCodes.ABORTED', async () => {
			const { executor } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, { mode: 'queue' });

			const ctrl = new AbortController();
			const p = scheduler.solve('def', [{ ParamName: 'a', InnerTree: {} } as any], {
				signal: ctrl.signal
			});

			ctrl.abort();
			await expect(p).rejects.toMatchObject({ code: ErrorCodes.ABORTED });
		});
	});

	describe('cache', () => {
		it('returns cached response without invoking executor', async () => {
			const { executor, queue } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'queue',
				cache: { maxBytes: 100_000 }
			});

			const tree = [{ ParamName: 'x', InnerTree: {} } as any];
			const first = scheduler.solve('def', tree);
			queue[0].release(makeResponse('hit'));
			await first;

			// Same input → cache hit
			const second = await scheduler.solve('def', tree);
			expect(second.filename).toBe('hit');
			expect(queue).toHaveLength(1); // executor not called again
		});

		it('respects ttl', async () => {
			const { executor, queue } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'queue',
				cache: { ttlMs: 10, maxBytes: 100_000 }
			});

			const tree = [{ ParamName: 'x', InnerTree: {} } as any];
			const first = scheduler.solve('def', tree);
			queue[0].release(makeResponse('one'));
			await first;

			await new Promise((r) => setTimeout(r, 20));

			const secondPromise = scheduler.solve('def', tree);
			await vi.waitFor(() => expect(queue.length).toBe(2));
			queue[1].release(makeResponse('two'));
			const second = await secondPromise;
			expect(second.filename).toBe('two');
		});

		it('retains entries far past any count cap, bounded only by maxBytes', async () => {
			const { executor, queue } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'queue',
				cache: { maxBytes: 100_000 }
			});

			const trees = ['a', 'b', 'c'].map((n) => [{ ParamName: n, InnerTree: {} } as any]);
			for (let i = 0; i < 3; i++) {
				const p = scheduler.solve('def', trees[i]);
				await vi.waitFor(() => expect(queue.length).toBe(i + 1));
				const response = makeResponse(String(i + 1));
				setResponseWireSize(response, 100);
				queue[i].release(response);
				await p;
			}

			expect(scheduler.cacheStats()).toMatchObject({ entries: 3, evictions: 0 });
			// The oldest entry survives a count that would have evicted it under any cap.
			expect((await scheduler.solve('def', trees[0])).filename).toBe('1');
			expect(queue.length).toBe(3);
		});

		// Byte budget (audit C2): entries are bounded by total bytes alongside the
		// entry count, sized by the wire-size hint (or a stringify fallback).
		it('evicts LRU when retained bytes exceed maxBytes', async () => {
			const { executor, queue } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'queue',
				cache: { maxBytes: 250 }
			});

			const trees = ['a', 'b', 'c'].map((n) => [{ ParamName: n, InnerTree: {} } as any]);
			for (let i = 0; i < 3; i++) {
				const p = scheduler.solve('def', trees[i]);
				await vi.waitFor(() => expect(queue.length).toBe(i + 1));
				const response = makeResponse(String(i + 1));
				setResponseWireSize(response, 100);
				queue[i].release(response);
				await p;
			}

			// 3 × 100 bytes > 250 → the oldest entry was evicted.
			expect(scheduler.cacheStats()).toMatchObject({ entries: 2, bytes: 200 });
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

			const tree = [{ ParamName: 'x', InnerTree: {} } as any];
			const first = scheduler.solve('def', tree);
			const oversized = makeResponse('big');
			setResponseWireSize(oversized, 1000);
			queue[0].release(oversized);
			expect((await first).filename).toBe('big'); // served through…

			expect(scheduler.cacheStats()).toMatchObject({ entries: 0, bytes: 0 }); // …never retained
			const second = scheduler.solve('def', tree);
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

			const tree = [{ ParamName: 'x', InnerTree: {} } as any];
			const first = scheduler.solve('def', tree);
			queue[0].release(makeResponse('one')); // no hint → stringify fallback → oversized
			await first;

			expect(scheduler.cacheStats().entries).toBe(0);
		});

		it('releases an entry’s bytes when it expires via ttl', async () => {
			const { executor, queue } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'queue',
				cache: { ttlMs: 10, maxBytes: 1000 }
			});

			const tree = [{ ParamName: 'x', InnerTree: {} } as any];
			const first = scheduler.solve('def', tree);
			const response = makeResponse('one');
			setResponseWireSize(response, 100);
			queue[0].release(response);
			await first;
			expect(scheduler.cacheStats()).toMatchObject({ entries: 1, bytes: 100 });

			await new Promise((r) => setTimeout(r, 20));
			const second = scheduler.solve('def', tree); // expired read drops the entry
			expect(scheduler.cacheStats()).toMatchObject({ entries: 0, bytes: 0 });
			await vi.waitFor(() => expect(queue.length).toBe(2));
			queue[1].release(makeResponse('two'));
			await second;
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
				const tree = [{ ParamName: 'x', InnerTree: {} } as any];

				const first = scheduler.solve('def', tree);
				await vi.waitFor(() => expect(queue.length).toBe(1));
				queue[0].release(makeResponse('one'));
				await first;
				expect(scheduler.cacheStats()).toMatchObject({ hits: 0, misses: 1 });

				await scheduler.solve('def', tree); // served from cache
				expect(scheduler.cacheStats()).toMatchObject({ hits: 1, misses: 1 });
			});

			it('counts a TTL-expired read as a miss, not a hit', async () => {
				const { executor, queue } = deferredExecutor();
				const scheduler = new SolveScheduler(executor, baseConfig, {
					mode: 'queue',
					cache: { ttlMs: 10, maxBytes: 100_000 }
				});
				const tree = [{ ParamName: 'x', InnerTree: {} } as any];

				const first = scheduler.solve('def', tree);
				await vi.waitFor(() => expect(queue.length).toBe(1));
				queue[0].release(makeResponse('one'));
				await first;

				await new Promise((r) => setTimeout(r, 20));
				const second = scheduler.solve('def', tree);
				// The solve ran again, so this is a miss — which is what a hit rate
				// is measuring, regardless of why the entry was gone.
				expect(scheduler.cacheStats()).toMatchObject({ hits: 0, misses: 2 });
				await vi.waitFor(() => expect(queue.length).toBe(2));
				queue[1].release(makeResponse('two'));
				await second;
			});

			it('counts evictions only under byte pressure, not replacement', async () => {
				const { executor, queue } = deferredExecutor();
				const scheduler = new SolveScheduler(executor, baseConfig, {
					mode: 'queue',
					cache: { maxBytes: 250 }
				});

				const trees = ['a', 'b', 'c'].map((n) => [{ ParamName: n, InnerTree: {} } as any]);
				for (let i = 0; i < 3; i++) {
					const p = scheduler.solve('def', trees[i]);
					await vi.waitFor(() => expect(queue.length).toBe(i + 1));
					const response = makeResponse(String(i + 1));
					setResponseWireSize(response, 100);
					queue[i].release(response);
					await p;
				}
				// 3 × 100 > 250 → exactly one entry pushed out by the byte budget.
				expect(scheduler.cacheStats()).toMatchObject({ evictions: 1 });
			});

			it('keeps counters across clearCache so a hit rate stays comparable', async () => {
				const { executor, queue } = deferredExecutor();
				const scheduler = new SolveScheduler(executor, baseConfig, {
					mode: 'queue',
					cache: { maxBytes: 100_000 }
				});
				const tree = [{ ParamName: 'x', InnerTree: {} } as any];

				const first = scheduler.solve('def', tree);
				await vi.waitFor(() => expect(queue.length).toBe(1));
				queue[0].release(makeResponse('one'));
				await first;

				scheduler.clearCache();
				expect(scheduler.cacheStats()).toMatchObject({ entries: 0, bytes: 0, misses: 1 });
			});
		});

		// Regression (issue 50): a cache hit returned before enqueue(), so in
		// latest-wins mode it didn't supersede the older in-flight solve — which
		// later completed, overwrote lastResult, and snapped the UI back.
		it('latest-wins: a cache hit supersedes the older in-flight solve', async () => {
			const { executor, queue } = deferredExecutor();
			const onSettle = vi.fn();
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'latest-wins',
				cache: { maxBytes: 100_000 },
				onSettle
			});

			// Prime the cache with input X.
			const treeX = [{ ParamName: 'x', InnerTree: {} } as any];
			const prime = scheduler.solve('def', treeX);
			queue[0].release(makeResponse('x-cached'));
			await prime;

			// Y goes in flight, then X arrives and hits the cache.
			const treeY = [{ ParamName: 'y', InnerTree: {} } as any];
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

		// Regression (issue 67): the cache was consulted before the
		// already-aborted-signal check, so an aborted call could resolve.
		it('an already-aborted signal rejects ABORTED even on a cache hit', async () => {
			const { executor, queue } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'queue',
				cache: { maxBytes: 100_000 }
			});

			const tree = [{ ParamName: 'x', InnerTree: {} } as any];
			const prime = scheduler.solve('def', tree);
			queue[0].release(makeResponse('cached'));
			await prime;

			const ctrl = new AbortController();
			ctrl.abort();
			await expect(scheduler.solve('def', tree, { signal: ctrl.signal })).rejects.toMatchObject({
				code: ErrorCodes.ABORTED
			});
		});

		// Decision 2026-07-11 (issue 114): an errored solve is a valid,
		// deterministic GH result and IS cached by default.
		it('caches responses with GH errors by default', async () => {
			const { executor, queue } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'queue',
				cache: { maxBytes: 100_000 }
			});

			const tree = [{ ParamName: 'x', InnerTree: {} } as any];
			const errored = { ...makeResponse('errored'), errors: ['guard tripped'] };

			const first = scheduler.solve('def', tree);
			queue[0].release(errored);
			await first;

			const second = await scheduler.solve('def', tree);
			expect(second.errors).toEqual(['guard tripped']);
			expect(queue).toHaveLength(1); // served from cache
		});

		it('skips caching errored solves when cacheErroredSolves is false', async () => {
			const { executor, queue } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'queue',
				cache: { cacheErroredSolves: false, maxBytes: 100_000 }
			});

			const tree = [{ ParamName: 'x', InnerTree: {} } as any];

			const first = scheduler.solve('def', tree);
			queue[0].release({ ...makeResponse('errored'), errors: ['guard tripped'] });
			await first;

			// Not cached — the identical input executes again...
			const secondPromise = scheduler.solve('def', tree);
			await vi.waitFor(() => expect(queue.length).toBe(2));
			queue[1].release(makeResponse('clean'));
			await secondPromise;

			// ...while error-free responses still cache normally.
			const third = await scheduler.solve('def', tree);
			expect(third.filename).toBe('clean');
			expect(queue).toHaveLength(2);
		});

		it('recognizes PascalCase `Errors` (stock mcneel casing) for cacheErroredSolves', async () => {
			const { executor, queue } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'queue',
				cache: { cacheErroredSolves: false, maxBytes: 100_000 }
			});

			const tree = [{ ParamName: 'x', InnerTree: {} } as any];

			const first = scheduler.solve('def', tree);
			queue[0].release({ ...makeResponse('errored'), Errors: ['guard tripped'] } as any);
			await first;

			// Not cached — the identical input executes again.
			const secondPromise = scheduler.solve('def', tree);
			await vi.waitFor(() => expect(queue.length).toBe(2));
			queue[1].release(makeResponse('clean'));
			await secondPromise;
		});
	});

	describe('observability', () => {
		it('notifies subscribers on state change', async () => {
			const { executor, queue } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig);
			const listener = vi.fn();
			scheduler.subscribe(listener);

			const p = scheduler.solve('def', []);
			expect(listener).toHaveBeenCalled();

			queue[0].release(makeResponse('x'));
			await p;

			// Settle should also notify
			expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);
		});

		it('exposes lastResult / lastError / lastDurationMs', async () => {
			const { executor, queue } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig);

			const p1 = scheduler.solve('def', []);
			queue[0].release(makeResponse('ok'));
			await p1;

			expect(scheduler.lastResult?.filename).toBe('ok');
			expect(scheduler.lastDurationMs).toBeGreaterThanOrEqual(0);
			expect(scheduler.lastError).toBeNull();

			const p2 = scheduler.solve('def', [{ ParamName: 'fail', InnerTree: {} } as any]);
			queue[1].fail(new Error('boom'));
			await expect(p2).rejects.toBeInstanceOf(ComputeError);
			expect(scheduler.lastError).toBeInstanceOf(ComputeError);
		});

		it('fires onStart and onSettle hooks', async () => {
			const { executor, queue } = deferredExecutor();
			const onStart = vi.fn();
			const onSettle = vi.fn();
			const scheduler = new SolveScheduler(executor, baseConfig, { onStart, onSettle });

			const p = scheduler.solve('def', []);
			expect(onStart).toHaveBeenCalledTimes(1);

			queue[0].release(makeResponse('x'));
			await p;

			expect(onSettle).toHaveBeenCalledTimes(1);
			expect(onSettle.mock.calls[0][1]).toMatchObject({ status: 'success', fromCache: false });
		});
	});

	describe('dispose', () => {
		it('cancels everything and rejects new calls', async () => {
			const { executor } = deferredExecutor();
			const scheduler = new SolveScheduler(executor, baseConfig, {
				mode: 'queue',
				maxConcurrent: 1
			});

			const a = scheduler.solve('def', [{ ParamName: 'a', InnerTree: {} } as any]);
			const b = scheduler.solve('def', [{ ParamName: 'b', InnerTree: {} } as any]);

			scheduler.dispose();

			await expect(a).rejects.toBeInstanceOf(ComputeError);
			await expect(b).rejects.toBeInstanceOf(ComputeError);

			await expect(scheduler.solve('def', [])).rejects.toMatchObject({
				code: ErrorCodes.INVALID_STATE
			});
		});
	});
});
