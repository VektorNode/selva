import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UISchema } from '@selvajs/schemas';
import { createSolveSession, type SolveSession } from '../session/solve-session.js';
import { createRequestResponseDriver } from '../drivers/request-response.js';
import type { SolveDriver } from '../drivers/driver.js';
import { finalizeResult } from '../../shared/outcome.js';
import type { SolveFn, SolveResult } from '../../shared/solve-fn.js';

// The session and the real request/response driver together, against a `SolveFn` the test settles
// by hand: what happens when things finish in an awkward order.

const GATE = [{ level: 'warning' as const, message: 'check this', isGate: true }];

function schema(over: Partial<UISchema> = {}): UISchema {
	return {
		inputs: [{ id: 'a', paramType: 'number', default: 0 }],
		outputs: [{ id: 'o' }],
		layout: { type: 'flat', groups: [{ items: [] }] },
		...over
	} as unknown as UISchema;
}

const manual = () => schema({ instanceSolve: false });

interface Call {
	values: Record<string, unknown>;
	signal: AbortSignal;
	resolve(result: SolveResult): void;
	reject(err: unknown): void;
}

/** A `SolveFn` that rejects on abort, as `fetch` does. */
function deferred() {
	const calls: Call[] = [];
	const fn: SolveFn = (values, signal) =>
		new Promise((resolve, reject) => {
			calls.push({ values, signal, resolve, reject });
			signal.addEventListener('abort', () => reject(new DOMException('stop', 'AbortError')));
		});
	return { fn, calls };
}

function make(
	onSolve: SolveFn,
	{
		deadline = 60_000,
		sch = schema(),
		meshPolicy
	}: {
		deadline?: number;
		sch?: UISchema;
		meshPolicy?: Parameters<typeof createRequestResponseDriver>[2]['meshPolicy'];
	} = {}
) {
	const holder: { session?: SolveSession } = {};
	const driver = createRequestResponseDriver(onSolve, () => holder.session!, {
		solveDeadlineMs: deadline,
		onChange: () => holder.session?.notify(),
		meshPolicy
	});
	const session = createSolveSession({ schema: sch, scopeKey: 'k', driver });
	holder.session = session;
	return { session, driver };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('a solve that never settles', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	const never: SolveFn = () => new Promise(() => {});

	it('fails at the deadline, frees the session, and the next edit solves', async () => {
		const calls: unknown[] = [];
		const { session } = make(
			(values) => {
				calls.push(values);
				return new Promise(() => {});
			},
			{ deadline: 50 }
		);
		const settled = session.solve();
		await vi.advanceTimersByTimeAsync(60);

		await expect(settled).resolves.toMatchObject({ status: 'failed' });
		expect(session.isSolving).toBe(false);
		expect(session.error).toContain('longer than');

		session.setValue('a', 2);
		await vi.advanceTimersByTimeAsync(1);
		expect(calls).toHaveLength(2);
	});

	it('stops on abort, without waiting for the deadline', async () => {
		const { session } = make(never);
		const settled = session.solve();
		await vi.advanceTimersByTimeAsync(1);
		session.abort();
		await vi.advanceTimersByTimeAsync(1);

		await expect(settled).resolves.toMatchObject({ status: 'aborted' });
		expect(session.isSolving).toBe(false);
	});

	it('drops a settlement that arrives after the stop', async () => {
		let lateResolve!: (r: SolveResult) => void;
		const { session } = make(() => new Promise((resolve) => (lateResolve = resolve)), {
			deadline: 50
		});
		void session.solve();
		await vi.advanceTimersByTimeAsync(60);
		lateResolve({ outputs: { o: 'late' } });
		await vi.advanceTimersByTimeAsync(1);
		expect(session.values.o).toBe(null);
		expect(session.lastResult).toBeNull();
	});
});

describe('rebuild during a solve', () => {
	it('a manual definition never shows the old result', async () => {
		const { fn, calls } = deferred();
		const { session } = make(fn);
		session.setValue('a', 1);
		session.rebuild(manual(), 'k2');
		expect(calls[0].signal.aborted).toBe(true);

		calls[0].resolve({ outputs: { o: 'OLD' }, meshes: ['OLD-MESH'] });
		await flush();

		expect(session.meshes).toEqual([]);
		expect(session.values.o).toBe(null);
		expect(session.hasNeverSolved).toBe(true);
		expect(session.hasPendingChanges).toBe(true);
		expect(session.lastResult).toBeNull();
	});

	it('the old run does not report at all, so the new session settles nothing', async () => {
		const { fn } = deferred();
		const { session } = make(fn);
		const seen: string[] = [];
		session.onSettled((s) => seen.push(s.status));
		session.setValue('a', 1);
		session.rebuild(manual(), 'k2');
		await flush();
		expect(seen).toEqual([]);
	});

	it('the old result does not fill the memo for equal input ids', async () => {
		const { fn, calls } = deferred();
		const { session } = make(fn);
		session.setValue('a', 1);
		session.rebuild(schema(), 'k');
		session.setValue('a', 1);
		calls[0].resolve({ outputs: { o: 'v1-result' } });
		await flush();

		expect(calls).toHaveLength(2);
		expect(calls[1].values.a).toBe(1);
		expect(session.values.o).toBe(null);
	});

	it('aborts the old fetch', () => {
		const { fn, calls } = deferred();
		const { session } = make(fn);
		session.setValue('a', 1);
		session.rebuild(schema(), 'k');
		expect(calls[0].signal.aborted).toBe(true);
	});

	it('resets a driver in manual mode too, leaving nothing dispatched', () => {
		const reset = vi.fn();
		const solve = vi.fn();
		const driver: SolveDriver = { solve, cancel() {}, isSolving: false, reset };
		const session = createSolveSession({ schema: manual(), scopeKey: 'k', driver });
		session.rebuild(manual(), 'k2');
		expect(reset).toHaveBeenCalledTimes(1);
		expect(solve).not.toHaveBeenCalled();
	});
});

describe('dispose', () => {
	it('stops the running solve and the queued one', async () => {
		const { fn, calls } = deferred();
		const { session } = make(fn);
		session.setValue('a', 1);
		session.setValue('a', 2);
		session.dispose();
		expect(calls[0].signal.aborted).toBe(true);
		await flush();
		expect(calls).toHaveLength(1);
	});

	it('leaves the session inert', async () => {
		const { fn, calls } = deferred();
		const { session } = make(fn);
		session.dispose();
		session.setValue('a', 3);
		session.loadValues({ a: 4 });
		session.rebuild(schema(), 'k2');
		await flush();
		expect(calls).toHaveLength(0);
		await expect(session.solve()).resolves.toEqual({ status: 'aborted', diagnostics: [] });
		await expect(session.ensureSolved()).resolves.toEqual({ status: 'aborted', diagnostics: [] });
	});

	it('releases what the memo holds', async () => {
		const release = vi.fn();
		const meshPolicy = { clone: (m: unknown[]) => [...m], release };
		const { session } = make(async () => ({ outputs: {}, meshes: ['m'] }), { meshPolicy });
		await session.solve();
		session.dispose();
		expect(release).toHaveBeenCalledTimes(1);
	});

	it('does not touch a push driver, whose solve belongs to the canvas', () => {
		const cancel = vi.fn();
		const driver: SolveDriver = { solve() {}, cancel, isSolving: true };
		createSolveSession({ schema: schema(), scopeKey: 'k', driver }).dispose();
		expect(cancel).not.toHaveBeenCalled();
	});
});

describe('ensureSolved after a solve that left no answer', () => {
	it('solves again after an abort, instead of handing out the older result', async () => {
		const { fn, calls } = deferred();
		const { session } = make(fn);
		session.setValue('a', 1);
		calls[0].resolve({ outputs: { o: 'for1' } });
		await flush();

		session.setValue('a', 2);
		await flush();
		session.abort();
		await flush();

		const settled = session.ensureSolved();
		await flush();
		expect(calls).toHaveLength(3);
		expect(calls[2].values.a).toBe(2);
		calls[2].resolve({ outputs: { o: 'for2' } });
		await expect(settled).resolves.toMatchObject({
			status: 'applied',
			result: { values: { a: 2 } }
		});
	});

	it('does the same for a push driver that reports no `values`', async () => {
		const solves: unknown[] = [];
		const driver: SolveDriver = { solve: (v) => solves.push(v), cancel() {}, isSolving: false };
		const session = createSolveSession({ schema: schema(), scopeKey: 'k', driver });
		session.report({ outputs: { o: 1 } });
		session.setValue('a', 2);
		session.reportAborted();
		void session.ensureSolved();
		expect(solves).toHaveLength(2);
	});

	it('settles discarded inputs as discarded, without asking the user again', async () => {
		const { fn, calls } = deferred();
		const { session } = make(fn);
		session.setValue('a', 1);
		calls[0].resolve({ outputs: { o: 'for1' } });
		await flush();
		session.setValue('a', 2);
		await flush();
		calls[1].resolve({ outputs: { o: 'for2' }, diagnostics: GATE });
		await flush();

		session.discard();
		await expect(session.ensureSolved()).resolves.toEqual({
			status: 'discarded',
			diagnostics: GATE
		});
		expect(calls).toHaveLength(2);
	});

	it('solves after an error', async () => {
		const { fn, calls } = deferred();
		const { session } = make(fn);
		session.setValue('a', 1);
		calls[0].reject(new Error('net'));
		await flush();
		void session.ensureSolved();
		await flush();
		expect(calls).toHaveLength(2);
	});

	it('answers blocked from a block, without solving', async () => {
		const { fn, calls } = deferred();
		const { session } = make(fn);
		session.setValue('a', 1);
		calls[0].resolve({ outputs: {}, blocked: true, diagnostics: GATE });
		await flush();
		await expect(session.ensureSolved()).resolves.toMatchObject({ status: 'blocked' });
		expect(calls).toHaveLength(1);
	});
});

describe('an edit during a manual solve', () => {
	it('stays dirty when the solve running it follows a failed one', async () => {
		const { fn, calls } = deferred();
		const { session } = make(fn, { sch: manual() });
		session.setValue('a', 1);
		void session.solve();
		await flush();
		session.setValue('a', 2);
		void session.solve();
		calls[0].reject(new Error('net'));
		await flush();
		session.setValue('a', 3);
		calls[1].resolve({ outputs: { o: 'for2' } });
		await flush();

		expect(session.hasPendingChanges).toBe(true);
	});

	it('stays dirty once the older result lands', async () => {
		const { fn, calls } = deferred();
		const { session } = make(fn, { sch: manual() });
		session.setValue('a', 1);
		void session.solve();
		await flush();
		session.setValue('a', 2);
		calls[0].resolve({ outputs: { o: 'for1' } });
		await flush();

		expect(session.hasPendingChanges).toBe(true);
		expect(session.lastResult?.values?.a).toBe(1);

		void session.ensureSolved();
		await flush();
		expect(calls).toHaveLength(2);
	});

	it('clears when the value went back to what was solved', async () => {
		const { fn, calls } = deferred();
		const { session } = make(fn, { sch: manual() });
		session.setValue('a', 1);
		void session.solve();
		await flush();
		session.setValue('a', 2);
		session.setValue('a', 1);
		calls[0].resolve({ outputs: {} });
		await flush();
		expect(session.hasPendingChanges).toBe(false);
	});

	it('works from the dispatch snapshot on a push driver', () => {
		const driver: SolveDriver = { solve() {}, cancel() {}, isSolving: false };
		const session = createSolveSession({ schema: manual(), scopeKey: 'k', driver });
		void session.solve();
		session.setValue('a', 9);
		session.report({ outputs: {} });
		expect(session.hasPendingChanges).toBe(true);
	});

	it('stays dirty after an aborted result, which answered nothing', () => {
		const driver: SolveDriver = { solve() {}, cancel() {}, isSolving: false };
		const session = createSolveSession({ schema: manual(), scopeKey: 'k', driver });
		void session.solve();
		session.report({ outputs: {}, blocked: true, aborted: true });
		expect(session.hasPendingChanges).toBe(true);
	});
});

describe('an aborted result', () => {
	it('stays out of the memo, so the same values solve again', async () => {
		let n = 0;
		const fn: SolveFn = async () =>
			++n === 1
				? finalizeResult({ outputs: {} }, { diagnostics: [], blocked: true, aborted: true })
				: { outputs: { o: 'real' } };
		const { session } = make(fn);

		expect((await session.solve()).status).toBe('aborted');
		expect((await session.solve()).status).toBe('applied');
		expect(n).toBe(2);
		expect(session.values.o).toBe('real');
	});
});

describe('a failing solve', () => {
	it('writes no memo entry', async () => {
		let n = 0;
		const fn: SolveFn = async () => {
			if (++n === 1) throw new Error('net');
			return { outputs: { o: 'ok' } };
		};
		const { session } = make(fn);
		expect((await session.solve()).status).toBe('failed');
		expect((await session.solve()).status).toBe('applied');
		expect(n).toBe(2);
	});
});

describe('a held result and a newer solve', () => {
	async function heldThenEdit() {
		const { fn, calls } = deferred();
		const { session } = make(fn);
		const seen: string[] = [];
		session.onSettled((s) => seen.push(s.status));
		session.setValue('a', 1);
		calls[0].resolve({ outputs: { o: 'for1' }, diagnostics: GATE });
		await flush();
		expect(session.phase).toBe('review');
		return { session, calls, seen };
	}

	it('drops at dispatch, so acknowledge cannot commit it over the newer solve', async () => {
		const { session, calls, seen } = await heldThenEdit();
		const settled = (session.setValue('a', 2), session.solve());
		await flush();
		expect(session.awaitingAck).toBe(false);
		session.acknowledge();
		expect(session.lastResult).toBeNull();
		expect(seen).toEqual(['discarded']);

		calls[1].resolve({ outputs: { o: 'for2' } });
		await expect(settled).resolves.toMatchObject({ result: { values: { a: 2 } } });
	});

	it('a caller already waiting on it resolves with what lands', async () => {
		const { session, calls } = await heldThenEdit();
		const waiting = session.ensureSolved();
		session.setValue('a', 2);
		await flush();
		calls[1].resolve({ outputs: { o: 'for2' } });
		await expect(waiting).resolves.toMatchObject({
			status: 'applied',
			result: { outputs: { o: 'for2' } }
		});
	});

	it('leaves no review behind when the newer solve fails', async () => {
		const { session, calls, seen } = await heldThenEdit();
		session.setValue('a', 2);
		await flush();
		calls[1].reject(new Error('net'));
		await flush();

		expect(session.phase).toBe('idle');
		expect(session.error).toBe('net');
		session.acknowledge();
		expect(session.lastResult).toBeNull();
		expect(seen).toEqual(['discarded', 'failed']);
	});
});

// The five ways a solve ends now share one path. These pin where they must still differ.
describe('landing policy', () => {
	function queued() {
		const driver = {
			queued: false,
			solve() {},
			cancel() {},
			isSolving: false,
			get hasQueued() {
				return this.queued;
			}
		};
		const session = createSolveSession({ schema: schema(), scopeKey: 'k', driver });
		const seen: string[] = [];
		session.onSettled((s) => seen.push(s.status));
		return { driver, session, seen };
	}

	it('a gated result with a queued solve behind it neither holds nor settles', () => {
		const { driver, session, seen } = queued();
		driver.queued = true;
		session.report({ outputs: { o: 1 }, diagnostics: GATE });
		expect(session.awaitingAck).toBe(false);
		expect(seen).toEqual([]);
	});

	it('a failure or abort with a queued solve behind it does not settle', () => {
		const { driver, session, seen } = queued();
		driver.queued = true;
		session.reportError('boom');
		session.reportAborted();
		expect(seen).toEqual([]);
	});

	it('every other ending settles exactly once', () => {
		const { session, seen } = queued();
		session.report({ outputs: {} });
		session.report({ outputs: {}, blocked: true });
		session.report({ outputs: {}, blocked: true, aborted: true });
		session.reportError('boom');
		session.reportAborted();
		session.report({ outputs: {}, diagnostics: GATE });
		session.acknowledge();
		session.report({ outputs: {}, diagnostics: GATE });
		session.discard();
		expect(seen).toEqual([
			'applied',
			'blocked',
			'aborted',
			'failed',
			'aborted',
			'applied',
			'discarded'
		]);
	});
});

describe('a host callback that throws', () => {
	it('an onSettled listener cannot turn a good solve into a failed one', async () => {
		const { session } = make(async () => ({ outputs: { o: 1 } }));
		const seen: string[] = [];
		session.onSettled((s) => {
			seen.push(s.status);
			throw new Error('host bug');
		});
		await expect(session.solve()).resolves.toMatchObject({ status: 'applied' });
		await flush();
		expect(seen).toEqual(['applied']);
		expect(session.error).toBe('');
	});

	it('a subscriber cannot strand solve()', async () => {
		const { session } = make(async () => ({ outputs: { o: 1 } }));
		session.subscribe(() => {
			throw new Error('render bug');
		});
		await expect(session.solve()).resolves.toMatchObject({ status: 'applied' });
		expect(session.isSolving).toBe(false);
	});

	it('one throwing subscriber does not cost the others their update', () => {
		const driver: SolveDriver = { solve() {}, cancel() {}, isSolving: false };
		const session = createSolveSession({ schema: schema(), scopeKey: 'k', driver });
		const after = vi.fn();
		session.subscribe(() => {
			throw new Error('render bug');
		});
		session.subscribe(after);
		session.report({ outputs: {} });
		expect(after).toHaveBeenCalledTimes(1);
	});

	it('a mesh policy throwing on a memo hit fails that solve instead of hanging it', async () => {
		let clones = 0;
		const meshPolicy = {
			clone(meshes: unknown[]) {
				// The first copy goes into the memo; the second is the hit.
				if (++clones > 1) throw new Error('clone failed');
				return [...meshes];
			},
			release() {}
		};
		const { session } = make(async () => ({ outputs: {}, meshes: ['m'] }), { meshPolicy });
		await session.solve();
		await expect(session.solve()).resolves.toEqual({ status: 'failed', error: 'clone failed' });
	});

	it('an unserializable value fails the solve instead of hanging it', async () => {
		const { session } = make(async () => ({ outputs: {} }));
		const settled = session.solve();
		session.setValue('a', 1n);
		await expect(settled).resolves.toMatchObject({ status: 'failed' });
	});
});

describe('a subscriber starting a solve as the last one ends', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('that solve keeps its abort and its deadline', async () => {
		const { fn, calls } = deferred();
		const { session } = make(fn, { deadline: 60 });
		let once = true;
		session.subscribe(() => {
			if (!session.isSolving && session.lastResult && once) {
				once = false;
				session.setValue('a', 2);
			}
		});

		session.setValue('a', 1);
		calls[0].resolve({ outputs: {} });
		await vi.advanceTimersByTimeAsync(1);
		expect(calls).toHaveLength(2);

		session.abort();
		expect(calls[1].signal.aborted).toBe(true);
	});
});

describe('session.loadValues', () => {
	it('solves the merged set in auto mode', async () => {
		const { fn, calls } = deferred();
		const { session } = make(fn);
		session.loadValues({ a: 7 });
		await flush();
		expect(calls[0].values).toEqual({ a: 7 });
	});

	it('marks dirty in manual mode, without solving', async () => {
		const { fn, calls } = deferred();
		const { session } = make(fn, { sch: manual() });
		session.loadValues({ a: 7 });
		await flush();
		expect(calls).toHaveLength(0);
		expect(session.values.a).toBe(7);
		expect(session.hasPendingChanges).toBe(true);
	});
});

describe('session.abort', () => {
	it('reaches the driver', () => {
		const cancel = vi.fn();
		const driver: SolveDriver = { solve() {}, cancel, isSolving: true };
		createSolveSession({ schema: schema(), scopeKey: 'k', driver }).abort();
		expect(cancel).toHaveBeenCalledTimes(1);
	});
});

describe('createRequestResponseDriver with an event source', () => {
	it('asks the server to cancel on abort and on reset', () => {
		const cancelCurrent = vi.fn();
		const driver = createRequestResponseDriver(
			async () => ({ outputs: {} }),
			() => ({ report() {}, reportError() {}, reportAborted() {} }),
			{ solveDeadlineMs: 1000, events: { subscribe: () => () => {}, cancelCurrent } }
		);
		driver.cancel();
		driver.reset?.();
		expect(cancelCurrent).toHaveBeenCalledTimes(2);
	});
});

// `packages/ui` debounces a slider at 150 ms, so these moves are spaced past it: each one reaches
// the session. The server allows 120 solves in 100 s.
describe('spaced slider moves against the rate limit', () => {
	const SERVER_LIMIT_PER_100S = 120;

	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	async function drag(opts: { moveMs: number; solveMs: number; value: (i: number) => number }) {
		let solves = 0;
		const fn: SolveFn = async () => {
			solves += 1;
			await new Promise((resolve) => setTimeout(resolve, opts.solveMs));
			return { outputs: {} };
		};
		const { session } = make(fn);
		for (let t = 0, i = 0; t < 100_000; t += opts.moveMs, i++) {
			session.setValue('a', opts.value(i));
			await vi.advanceTimersByTimeAsync(opts.moveMs);
		}
		return solves;
	}

	// A known overrun, pinned so a change to it is a decision: the throttle bounds concurrency, not
	// rate, so a fast solve leaves it idle and every move starts a request.
	it('overruns the limit at six moves a second with a fast solve', async () => {
		const solves = await drag({ moveMs: 160, solveMs: 50, value: (i) => i });
		expect(solves).toBeGreaterThan(SERVER_LIMIT_PER_100S);
	});

	it('stays under it once a solve is slower than the limit allows', async () => {
		const solves = await drag({ moveMs: 160, solveMs: 1000, value: (i) => i });
		expect(solves).toBeLessThan(SERVER_LIMIT_PER_100S);
	});

	it('costs nothing to revisit solved values', async () => {
		const solves = await drag({ moveMs: 160, solveMs: 50, value: (i) => i % 2 });
		expect(solves).toBe(2);
	});
});
