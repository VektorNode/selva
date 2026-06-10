import { describe, expect, it } from 'vitest';
import { createSolveSession, type SolveDriver } from './createSolveSession.svelte';
import type { UISchema } from '@selvajs/schemas';

// Covers the reactive wrapper's dispatch decisions — specifically the `forceSolve` path
// added for dynamic-value-list reconciliation. The pure transition logic is pinned in
// solve-session-core.test.ts; this file pins how the rune shell turns those decisions into
// driver.solve() calls. Rune module, so it runs under the svelte vitest plugin.

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
});
