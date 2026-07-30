import { describe, expect, it, vi } from 'vitest';
import { createSolveSession } from '../solve-session.js';
import { createRequestResponseDriver } from '../drivers/request-response.js';
import type { SolveDriver, SolveReporter } from '../drivers/driver.js';
import type { UISchema } from '@selvajs/schemas';
import type { SolveResult } from '../solve-fn.js';

// Covers the session shell's dispatch decisions — specifically the `forceSolve` path
// added for dynamic-value-list reconciliation. The pure transition logic is pinned in
// solve-session-core.test.ts; this file pins how the shell turns those decisions into
// driver.solve() calls.

function schema(instanceSolve?: boolean): UISchema {
	return {
		id: 'test',
		name: 'Test',
		instanceSolve,
		inputs: [{ id: 'a', paramId: 'a', paramType: 'text', default: 'x' }],
		outputs: [{ id: 'out' }],
		layout: { type: 'flat', groups: [{ items: [] }] }
	} as unknown as UISchema;
}

// Records every solve dispatch with the snapshot of values it received.
function recordingDriver(): SolveDriver & { solves: Record<string, unknown>[] } {
	const solves: Record<string, unknown>[] = [];
	return {
		solves,
		solve(values) {
			solves.push(values);
		},
		cancel() {},
		get isSolving() {
			return false;
		}
	};
}

describe('createSolveSession.setValue', () => {
	it('auto-solve mode dispatches on every value change', () => {
		const driver = recordingDriver();
		const session = createSolveSession({ schema: schema(true), scopeKey: 's', driver });
		session.setValue('a', 'y');
		expect(driver.solves.length).toBe(1);
		expect(driver.solves[0].a).toBe('y');
	});

	it('manual mode defers: marks pending, no dispatch', () => {
		const driver = recordingDriver();
		const session = createSolveSession({ schema: schema(false), scopeKey: 's', driver });
		session.setValue('a', 'y');
		expect(driver.solves.length).toBe(0);
		expect(session.hasPendingChanges).toBe(true);
	});

	it('forceSolve dispatches even in manual mode and clears the dirty flags', () => {
		const driver = recordingDriver();
		const session = createSolveSession({ schema: schema(false), scopeKey: 's', driver });
		// Reconcile a system-initiated change (e.g. a pruned dynamic-list selection).
		session.setValue('a', 'reconciled', true);
		expect(driver.solves.length).toBe(1);
		expect(driver.solves[0].a).toBe('reconciled');
		// The forced solve produces the matching output, so nothing is left pending.
		expect(session.hasPendingChanges).toBe(false);
	});

	it('forceSolve in auto mode still dispatches exactly once', () => {
		const driver = recordingDriver();
		const session = createSolveSession({ schema: schema(true), scopeKey: 's', driver });
		session.setValue('a', 'y', true);
		expect(driver.solves.length).toBe(1);
	});

	it('never echoes output-keyed values back to the driver', () => {
		const driver = recordingDriver();
		const session = createSolveSession({ schema: schema(true), scopeKey: 's', driver });
		// A solve result merges outputs into the session's values map (how widgets
		// like dynamic value lists read them) — e.g. a multi-MB options payload.
		session.report({ outputs: { out: { options: { huge: 'payload' } } } });
		session.setValue('a', 'y');
		expect(driver.solves.length).toBe(1);
		expect(driver.solves[0].a).toBe('y');
		// The output entry lives in session.values for widgets…
		expect(session.values.out).toBeDefined();
		// …but must not travel back through the transport.
		expect(driver.solves[0]).not.toHaveProperty('out');
	});
});

// M2: the request/response driver's client-side result memo. Verifies a slider returning
// to a solved value serves from memory (no onSolve call) and that a definition rebuild
// drops the memo so a stale result can't cross the swap.
describe('createRequestResponseDriver — client memo', () => {
	// Collects reported results so the memo hit/miss can be observed without a session.
	function collectingReporter(): SolveReporter & { reports: SolveResult[]; errors: string[] } {
		const reports: SolveResult[] = [];
		const errors: string[] = [];
		return {
			reports,
			errors,
			report: (r) => reports.push(r),
			reportError: (m) => errors.push(m)
		};
	}

	// Lets the throttle's fire-and-forget executeCompute settle.
	const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

	it('serves a repeated input from the memo without calling onSolve again', async () => {
		const onSolve = vi.fn(async (values: Record<string, unknown>): Promise<SolveResult> => ({
			outputs: { echo: values.a }
		}));
		const reporter = collectingReporter();
		const driver = createRequestResponseDriver(onSolve, () => reporter);

		driver.solve({ a: 1 });
		await flush();
		driver.solve({ a: 2 });
		await flush();
		driver.solve({ a: 1 }); // repeat — should hit the memo
		await flush();

		expect(onSolve).toHaveBeenCalledTimes(2); // only the two distinct inputs
		expect(reporter.reports).toHaveLength(3); // but all three solves reported
		expect(reporter.reports[2]).toEqual({ outputs: { echo: 1 } });
	});

	it('clearCache drops the memo so the next identical solve re-runs', async () => {
		const onSolve = vi.fn(async (): Promise<SolveResult> => ({ outputs: {} }));
		const reporter = collectingReporter();
		const driver = createRequestResponseDriver(onSolve, () => reporter);

		driver.solve({ a: 1 });
		await flush();
		driver.clearCache?.();
		driver.solve({ a: 1 }); // memo cleared → real solve again
		await flush();

		expect(onSolve).toHaveBeenCalledTimes(2);
	});

	it('session.rebuild clears the driver memo (no cross-definition stale hit)', async () => {
		const onSolve = vi.fn(async (): Promise<SolveResult> => ({ outputs: {} }));
		const reporter = collectingReporter();
		let clears = 0;
		// Wrap the real driver to observe clearCache being invoked from rebuild.
		const base = createRequestResponseDriver(onSolve, () => reporter);
		const driver: SolveDriver = {
			solve: base.solve,
			cancel: base.cancel,
			get isSolving() {
				return base.isSolving;
			},
			clearCache() {
				clears += 1;
				base.clearCache?.();
			}
		};
		const session = createSolveSession({ schema: schema(true), scopeKey: 's', driver });
		session.rebuild(schema(true), 's2');
		expect(clears).toBe(1);
	});
});

// The subscribe() seam replaced the session's former $state backing when it moved out of
// @selvajs/ui into this framework-free package. A reactive host subscribes once and
// republishes; if a mutation path forgets to emit, that host silently stops updating —
// which is exactly the failure these pin.
describe('createSolveSession.subscribe', () => {
	/** Subscribes and counts notifications. */
	function watch(session: ReturnType<typeof createSolveSession>) {
		let count = 0;
		const off = session.subscribe(() => {
			count += 1;
		});
		return {
			get count() {
				return count;
			},
			off
		};
	}

	it('notifies on a dispatching value change', () => {
		const session = createSolveSession({
			schema: schema(true),
			scopeKey: 's',
			driver: recordingDriver()
		});
		const w = watch(session);
		session.setValue('a', 'y');
		expect(w.count).toBe(1);
	});

	it('notifies on a deferred (manual-mode) value change, which dispatches nothing', () => {
		const session = createSolveSession({
			schema: schema(false),
			scopeKey: 's',
			driver: recordingDriver()
		});
		const w = watch(session);
		session.setValue('a', 'y');
		// No solve was dispatched, but hasPendingChanges flipped — a host must still repaint.
		expect(w.count).toBe(1);
		expect(session.hasPendingChanges).toBe(true);
	});

	it('notifies on report and reportError', () => {
		const session = createSolveSession({
			schema: schema(true),
			scopeKey: 's',
			driver: recordingDriver()
		});
		const w = watch(session);
		session.report({ outputs: { out: 1 } });
		expect(w.count).toBe(1);
		session.reportError('boom');
		expect(w.count).toBe(2);
		expect(session.error).toBe('boom');
	});

	it('notifies on rebuild in both the dispatching and gated paths', () => {
		const session = createSolveSession({
			schema: schema(true),
			scopeKey: 's',
			driver: recordingDriver()
		});
		const w = watch(session);
		session.rebuild(schema(true), 's2'); // seeds values -> dispatches
		expect(w.count).toBe(1);
		session.rebuild(schema(false), 's3'); // manual mode -> no dispatch, still a state change
		expect(w.count).toBe(2);
	});

	it('stops notifying after unsubscribe', () => {
		const session = createSolveSession({
			schema: schema(true),
			scopeKey: 's',
			driver: recordingDriver()
		});
		const w = watch(session);
		session.setValue('a', 'y');
		w.off();
		session.setValue('a', 'z');
		expect(w.count).toBe(1);
	});

	it('does not hand the live values map to the driver', () => {
		const driver = recordingDriver();
		const session = createSolveSession({ schema: schema(true), scopeKey: 's', driver });
		session.setValue('a', 'y');
		const dispatched = driver.solves[0];
		// A later change must not retroactively mutate a payload the transport already holds.
		session.setValue('a', 'z');
		expect(dispatched.a).toBe('y');
	});
});
