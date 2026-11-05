import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAsyncThrottle } from '../async-throttle.js';

// Pins the throttle state machine: single-in-flight, latest-pending-wins, timeout -> abort,
// and cancel clearing the pending slot. These are the non-obvious paths (the finally-block
// re-entry, the abort cleanup) where bugs hide.

// A controllable run fn: each call exposes a resolver so the test drives when a
// solve "finishes", plus records the values and the signal it was given.
function deferredRun() {
	const calls: { values: unknown; signal: AbortSignal; resolve: () => void }[] = [];
	const fn = (values: unknown, signal: AbortSignal) =>
		new Promise<void>((resolve) => {
			calls.push({ values, signal, resolve });
		});
	return { fn, calls };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

// Long enough never to fire in the tests that aren't about the deadline; the
// timeout tests below pass their own short value.
const TEST_DEADLINE_MS = 100_000;

describe('createAsyncThrottle', () => {
	it('runs immediately when idle and reports isRunning across the call', async () => {
		const { fn, calls } = deferredRun();
		const t = createAsyncThrottle<number>(fn, { runDeadlineMs: TEST_DEADLINE_MS });

		expect(t.isRunning).toBe(false);
		t.trigger(1);
		expect(t.isRunning).toBe(true);
		expect(calls).toHaveLength(1);
		expect(calls[0].values).toBe(1);

		calls[0].resolve();
		await tick();
		expect(t.isRunning).toBe(false);
		expect(t.hasPending).toBe(false);
	});

	it('keeps only one in flight; latest pending value wins, intermediates dropped', async () => {
		const { fn, calls } = deferredRun();
		const t = createAsyncThrottle<number>(fn, { runDeadlineMs: TEST_DEADLINE_MS });

		t.trigger(1);
		t.trigger(2);
		t.trigger(3); // overwrites the single pending slot — 2 is dropped
		expect(calls).toHaveLength(1);
		expect(t.hasPending).toBe(true);

		calls[0].resolve();
		await tick();
		expect(calls).toHaveLength(2);
		expect(calls[1].values).toBe(3); // not 2
		expect(t.hasPending).toBe(false);
	});

	it('cancel() clears the pending slot and aborts the in-flight signal', async () => {
		const { fn, calls } = deferredRun();
		const t = createAsyncThrottle<number>(fn, { runDeadlineMs: TEST_DEADLINE_MS });

		t.trigger(1);
		t.trigger(2);
		expect(t.hasPending).toBe(true);

		t.cancel();
		expect(t.hasPending).toBe(false);
		expect(calls[0].signal.aborted).toBe(true);

		// Resolving the aborted call must NOT start the (now-cleared) pending one.
		calls[0].resolve();
		await tick();
		expect(calls).toHaveLength(1);
	});

	describe('timeout', () => {
		beforeEach(() => vi.useFakeTimers());
		afterEach(() => vi.useRealTimers());

		it('aborts the in-flight request when the timeout elapses', async () => {
			const { fn, calls } = deferredRun();
			const t = createAsyncThrottle<number>(fn, { runDeadlineMs: 1000 });

			t.trigger(1);
			expect(calls[0].signal.aborted).toBe(false);

			vi.advanceTimersByTime(1000);
			expect(calls[0].signal.aborted).toBe(true);
		});

		it('names the abort a timeout, so a caller can tell it from a cancel', () => {
			const { fn, calls } = deferredRun();
			const t = createAsyncThrottle<number>(fn, { runDeadlineMs: 1000 });
			t.trigger(1);
			vi.advanceTimersByTime(1000);
			expect(calls[0].signal.reason.name).toBe('TimeoutError');
		});
	});

	describe('a run that rejects', () => {
		afterEach(() => vi.restoreAllMocks());

		it('frees the slot and starts the pending run', async () => {
			const error = vi.spyOn(console, 'error').mockImplementation(() => {});
			const seen: number[] = [];
			const t = createAsyncThrottle<number>(
				async (value) => {
					seen.push(value);
					if (value === 1) throw new Error('boom');
				},
				{ runDeadlineMs: TEST_DEADLINE_MS }
			);
			t.trigger(1);
			t.trigger(2);
			await tick();
			expect(seen).toEqual([1, 2]);
			expect(t.isRunning).toBe(false);
			expect(error).toHaveBeenCalledTimes(1);
		});

		it('stays quiet about an abort', async () => {
			const error = vi.spyOn(console, 'error').mockImplementation(() => {});
			const t = createAsyncThrottle<number>(
				async () => {
					throw new DOMException('stop', 'AbortError');
				},
				{ runDeadlineMs: TEST_DEADLINE_MS }
			);
			t.trigger(1);
			await tick();
			expect(error).not.toHaveBeenCalled();
		});
	});

	describe('onChange', () => {
		afterEach(() => vi.restoreAllMocks());

		it('throwing at the start does not leave isRunning stuck', async () => {
			vi.spyOn(console, 'error').mockImplementation(() => {});
			const { fn, calls } = deferredRun();
			let n = 0;
			const t = createAsyncThrottle<number>(fn, {
				runDeadlineMs: TEST_DEADLINE_MS,
				onChange() {
					if (++n === 1) throw new Error('onChange bug');
				}
			});
			t.trigger(1);
			calls[0].resolve();
			await tick();
			expect(t.isRunning).toBe(false);
		});

		it('starting a run from inside it keeps that run cancellable', async () => {
			const { fn, calls } = deferredRun();
			let restarted = false;
			const t = createAsyncThrottle<number>(fn, {
				runDeadlineMs: TEST_DEADLINE_MS,
				onChange() {
					if (!t.isRunning && !restarted) {
						restarted = true;
						t.trigger(2);
					}
				}
			});
			t.trigger(1);
			calls[0].resolve();
			await tick();
			expect(calls).toHaveLength(2);

			t.cancel();
			expect(calls[1].signal.aborted).toBe(true);
		});

		it('a run started from inside it does not race the pending one', async () => {
			const { fn, calls } = deferredRun();
			let restarted = false;
			const t = createAsyncThrottle<number>(fn, {
				runDeadlineMs: TEST_DEADLINE_MS,
				onChange() {
					if (!t.isRunning && !restarted) {
						restarted = true;
						t.trigger(3);
					}
				}
			});
			t.trigger(1);
			t.trigger(2);
			calls[0].resolve();
			await tick();
			expect(calls.map((c) => c.values)).toEqual([1, 3]);
			expect(t.hasPending).toBe(true);
		});
	});
});
