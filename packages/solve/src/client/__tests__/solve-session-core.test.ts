import { describe, expect, it } from 'vitest';
import {
	buildInitialValues,
	makeInitialFlags,
	applyValueChange,
	applySolveResult,
	commitSolveResult,
	needsAcknowledgement,
	type SolveSessionState
} from '../solve-session-core.js';
import type { UISchema } from '@selvajs/schemas';

// These tests pin the lifecycle state machine that used to live inline in
// ComputeApp.svelte: how values are seeded (incl. client-sourced hydration), when a
// value change should dispatch a solve vs. defer it, and what a reported solve result
// does to the flags. Reactivity is NOT exercised here — that's the thin rune wrapper's
// job. This is the pure decision layer.

// Minimal schema factory. `inputs`/`outputs` are the flat lists ComputeApp reads;
// `layout` is what getExternalInputs walks for client-sourced inputs.
function schema(partial: {
	inputs?: { id: string; paramType: string; default?: unknown }[];
	outputs?: { id: string }[];
	clientInputs?: string[];
	instanceSolve?: boolean;
}): UISchema {
	const clientSet = new Set(partial.clientInputs ?? []);
	const items = (partial.inputs ?? []).map((i) => ({
		type: 'input',
		id: i.id,
		paramId: i.id,
		displayName: i.id,
		...(clientSet.has(i.id) ? { source: { kind: 'client' } } : {})
	}));
	return {
		id: 'test-schema',
		name: 'Test',
		instanceSolve: partial.instanceSolve,
		inputs: partial.inputs ?? [],
		outputs: partial.outputs ?? [],
		layout: { type: 'flat', groups: [{ items }] }
	} as unknown as UISchema;
}

describe('buildInitialValues', () => {
	it('seeds non-client inputs from default, falling back to paramType default', () => {
		const s = schema({
			inputs: [
				{ id: 'a', paramType: 'number', default: 5 },
				{ id: 'b', paramType: 'text' }
			],
			outputs: [{ id: 'out' }]
		});
		const v = buildInitialValues(s, 'scope', () => undefined);
		expect(v.a).toBe(5);
		expect(v.b).toBe('');
		expect(v.out).toBe(null);
	});

	it('hydrates client-sourced inputs from the reader, leaving them undefined when absent', () => {
		const s = schema({
			inputs: [
				{ id: 'c', paramType: 'text', default: 'should-be-ignored' },
				{ id: 'd', paramType: 'text', default: 'also-ignored' }
			],
			clientInputs: ['c', 'd']
		});
		const read = (ref: { inputId: string }) => (ref.inputId === 'c' ? 'stored-c' : undefined);
		const v = buildInitialValues(s, 'scope', read);
		expect(v.c).toBe('stored-c');
		// Absent client value stays undefined (NOT the default) so the missing-inputs
		// panel can detect it.
		expect('d' in v).toBe(false);
	});
});

describe('makeInitialFlags', () => {
	it('starts pending+never-solved when instanceSolve === false', () => {
		expect(makeInitialFlags(false)).toEqual({ hasPendingChanges: true, hasNeverSolved: true });
	});
	it('starts clean when instanceSolve is true or absent', () => {
		expect(makeInitialFlags(true)).toEqual({ hasPendingChanges: false, hasNeverSolved: false });
		expect(makeInitialFlags(undefined)).toEqual({
			hasPendingChanges: false,
			hasNeverSolved: false
		});
	});
});

function state(overrides: Partial<SolveSessionState> = {}): SolveSessionState {
	return {
		values: {},
		error: '',
		computeErrors: [],
		computeWarnings: [],
		blocked: false,
		awaitingAck: false,
		heldResult: null,
		meshes: [],
		pendingValues: {},
		hasPendingChanges: false,
		hasNeverSolved: false,
		lastResult: null,
		...overrides
	};
}

describe('applyValueChange', () => {
	it('in auto-solve mode, records the value and asks to dispatch', () => {
		const s = state({ values: { a: 1 } });
		const out = applyValueChange(s, 'a', 2, /* instanceSolve */ true);
		expect(out.state.values.a).toBe(2);
		expect(out.shouldSolve).toBe(true);
		expect(out.state.hasPendingChanges).toBe(false);
	});

	it('in manual mode, defers: records pending + sets the flag, no dispatch', () => {
		const s = state({ values: { a: 1 } });
		const out = applyValueChange(s, 'a', 2, /* instanceSolve */ false);
		expect(out.state.values.a).toBe(2);
		expect(out.state.pendingValues.a).toBe(2);
		expect(out.state.hasPendingChanges).toBe(true);
		expect(out.shouldSolve).toBe(false);
	});
});

describe('applySolveResult', () => {
	it('merges outputs into values and clears the lifecycle flags', () => {
		const s = state({
			values: { a: 1, out: null },
			pendingValues: { a: 1 },
			hasPendingChanges: true,
			hasNeverSolved: true,
			error: 'stale'
		});
		const out = applySolveResult(s, {
			outputs: { out: 42 },
			meshes: [{ id: 'm' }]
		});
		expect(out.values.out).toBe(42);
		expect(out.values.a).toBe(1);
		expect(out.meshes).toEqual([{ id: 'm' }]);
		expect(out.pendingValues).toEqual({});
		expect(out.hasPendingChanges).toBe(false);
		expect(out.hasNeverSolved).toBe(false);
		expect(out.error).toBe('');
		expect(out.awaitingAck).toBe(false);
	});

	it('holds the result when the solve raised messages, and reports them regardless', () => {
		const s = state({
			values: { out: null },
			pendingValues: { a: 1 },
			hasPendingChanges: true,
			meshes: [{ id: 'previous' }]
		});
		const out = applySolveResult(s, {
			outputs: { out: 42 },
			errors: ['e'],
			warnings: ['w'],
			meshes: [{ id: 'm' }]
		});
		// Messages surface immediately — the dialog needs them to render.
		expect(out.computeErrors).toEqual(['e']);
		expect(out.computeWarnings).toEqual(['w']);
		expect(out.awaitingAck).toBe(true);
		// The result itself waits: the viewer keeps showing what it had.
		expect(out.values.out).toBe(null);
		expect(out.meshes).toEqual([{ id: 'previous' }]);
		expect(out.heldResult?.outputs).toEqual({ out: 42 });
		// The inputs were solved, so they must not stay dirty and re-dispatch.
		expect(out.pendingValues).toEqual({});
		expect(out.hasPendingChanges).toBe(false);
	});

	it('treats missing result arrays as empty', () => {
		const out = applySolveResult(state(), { outputs: {} });
		expect(out.computeErrors).toEqual([]);
		expect(out.computeWarnings).toEqual([]);
		expect(out.meshes).toEqual([]);
		expect(out.blocked).toBe(false);
	});

	it('carries blocked through and holds its result', () => {
		const out = applySolveResult(state({ meshes: [{ id: 'stale' }] }), {
			outputs: {},
			errors: ['Wall too thin'],
			blocked: true
		});
		expect(out.blocked).toBe(true);
		expect(out.computeErrors).toEqual(['Wall too thin']);
		expect(out.awaitingAck).toBe(true);
	});

	it('clears blocked once a later clean solve arrives', () => {
		const blocked = applySolveResult(state(), {
			outputs: {},
			errors: ['nope'],
			blocked: true
		});
		const out = applySolveResult(blocked, { outputs: { a: 1 } });
		expect(out.blocked).toBe(false);
		expect(out.awaitingAck).toBe(false);
		expect(out.heldResult).toBe(null);
	});

	it('a newer held result replaces an older one, so confirming applies the latest', () => {
		const first = applySolveResult(state(), {
			outputs: { out: 1 },
			warnings: ['w'],
			meshes: [{ id: 'first' }]
		});
		const second = applySolveResult(first, {
			outputs: { out: 2 },
			warnings: ['w'],
			meshes: [{ id: 'second' }]
		});
		expect(second.heldResult?.outputs).toEqual({ out: 2 });
	});
});

describe('commitSolveResult', () => {
	it('applies a held result verbatim', () => {
		const held = applySolveResult(state({ values: { out: null } }), {
			outputs: { out: 42 },
			warnings: ['w'],
			meshes: [{ id: 'm' }]
		});
		const out = commitSolveResult(held, held.heldResult!);
		expect(out.values.out).toBe(42);
		expect(out.meshes).toEqual([{ id: 'm' }]);
		expect(out.hasNeverSolved).toBe(false);
	});
});

describe('needsAcknowledgement', () => {
	it('is false for a clean solve', () => {
		expect(needsAcknowledgement([], [])).toBe(false);
	});

	it('asks again for a repeated message: every solve is its own checkpoint', () => {
		expect(needsAcknowledgement([], ['same'])).toBe(true);
		expect(needsAcknowledgement([], ['same'])).toBe(true);
	});
});
