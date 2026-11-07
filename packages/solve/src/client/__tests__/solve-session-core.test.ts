import { describe, expect, it } from 'vitest';
import {
	buildInitialValues,
	createInitialState,
	applyLoadedValues,
	applyValueChange,
	applySolveResult,
	commitSolveResult,
	ensureSolvedStep,
	inputsChangedSince,
	needsAcknowledgement,
	pickInputValues,
	type SolveSessionState
} from '../session/solve-session-core.js';
import type { UISchema } from '@selvajs/schemas';

// Minimal schema factory. `inputs`/`outputs` are the flat lists a host reads; `layout` is what
// the session walks for client- and server-sourced inputs.
function schema(partial: {
	inputs?: { id: string; paramType: string; default?: unknown }[];
	outputs?: { id: string }[];
	clientInputs?: string[];
	serverInputs?: string[];
	instanceSolve?: boolean;
}): UISchema {
	const clientSet = new Set(partial.clientInputs ?? []);
	const serverSet = new Set(partial.serverInputs ?? []);
	const items = (partial.inputs ?? []).map((i) => ({
		type: 'input',
		id: i.id,
		paramId: i.id,
		displayName: i.id,
		...(clientSet.has(i.id) ? { source: { kind: 'client' } } : {}),
		...(serverSet.has(i.id) ? { source: { kind: 'server', key: 'job.geometry' } } : {})
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

describe('createInitialState', () => {
	const create = (instanceSolve?: boolean) =>
		createInitialState(schema({ instanceSolve }), 'scope', () => undefined);

	it('starts pending+never-solved when instanceSolve === false', () => {
		expect(create(false)).toMatchObject({ hasPendingChanges: true, hasNeverSolved: true });
	});

	it('starts clean when instanceSolve is true or absent', () => {
		for (const instanceSolve of [true, undefined]) {
			expect(create(instanceSolve)).toMatchObject({
				hasPendingChanges: false,
				hasNeverSolved: false
			});
		}
	});
});

function state(overrides: Partial<SolveSessionState> = {}): SolveSessionState {
	return {
		values: {},
		error: '',
		computeErrors: [],
		computeWarnings: [],
		diagnostics: [],
		blocked: false,
		heldResult: null,
		meshes: [],
		hasPendingChanges: false,
		hasNeverSolved: false,
		lastResult: null,
		unsolved: null,
		...overrides
	};
}

describe('applyValueChange', () => {
	it('in auto-solve mode, records the value and asks to dispatch', () => {
		const s = state({ values: { a: 1 } });
		expect(applyValueChange(s, 'a', 2, /* instanceSolve */ true)).toBe(true);
		expect(s.values.a).toBe(2);
		expect(s.hasPendingChanges).toBe(false);
	});

	it('in manual mode, defers: sets the flag, no dispatch', () => {
		const s = state({ values: { a: 1 } });
		expect(applyValueChange(s, 'a', 2, /* instanceSolve */ false)).toBe(false);
		expect(s.values.a).toBe(2);
		expect(s.hasPendingChanges).toBe(true);
	});

	it('force overrides manual mode, and the solve covers every pending edit', () => {
		const s = state({ values: { a: 1 }, hasPendingChanges: true });
		expect(applyValueChange(s, 'a', 2, false, true)).toBe(true);
		expect(s.hasPendingChanges).toBe(false);
	});
});

describe('applyLoadedValues', () => {
	it('dispatches in auto mode', () => {
		const s = state();
		expect(applyLoadedValues(s, { a: 1 }, true)).toBe(true);
		expect(s.values.a).toBe(1);
		expect(s.hasPendingChanges).toBe(false);
	});

	it('marks dirty in manual mode', () => {
		const s = state();
		expect(applyLoadedValues(s, { a: 1 }, false)).toBe(false);
		expect(s.hasPendingChanges).toBe(true);
	});
});

describe('pickInputValues', () => {
	// The server refuses a solve that sets a server-sourced input, so sending its seeded default
	// would fail every solve of the schema.
	it('sends inputs only, and no server-sourced input even once edited', () => {
		const s = schema({
			inputs: [
				{ id: 'a', paramType: 'number', default: 1 },
				{ id: 'srv', paramType: 'text', default: 'seeded' }
			],
			outputs: [{ id: 'out' }],
			serverInputs: ['srv']
		});
		const values = buildInitialValues(s, 'scope', () => undefined);
		values.srv = 'edited';
		expect(pickInputValues(s, values)).toEqual({ a: 1 });
	});
});

describe('inputsChangedSince', () => {
	const s = schema({ inputs: [{ id: 'a', paramType: 'number' }], outputs: [{ id: 'o' }] });

	it('is false for the inputs that were sent, whatever the outputs did', () => {
		expect(inputsChangedSince(s, { a: 1, o: 'solved' }, { a: 1 })).toBe(false);
	});

	it('is true for a value edited after dispatch', () => {
		expect(inputsChangedSince(s, { a: 2 }, { a: 1 })).toBe(true);
	});

	it('is true for an input the dispatch did not carry', () => {
		expect(inputsChangedSince(s, { a: 1 }, {})).toBe(true);
	});

	it('is false with nothing sent: an unsolicited push frame covers what it covers', () => {
		expect(inputsChangedSince(s, { a: 1 }, null)).toBe(false);
	});
});

describe('applySolveResult', () => {
	const gate = { level: 'warning' as const, message: 'w', isGate: true };

	it('merges outputs into values and clears the lifecycle flags', () => {
		const s = state({
			values: { a: 1, out: null },
			hasPendingChanges: true,
			hasNeverSolved: true,
			error: 'stale'
		});
		applySolveResult(s, { outputs: { out: 42 }, meshes: [{ id: 'm' }] }, false);
		expect(s.values.out).toBe(42);
		expect(s.values.a).toBe(1);
		expect(s.meshes).toEqual([{ id: 'm' }]);
		expect(s.hasPendingChanges).toBe(false);
		expect(s.hasNeverSolved).toBe(false);
		expect(s.error).toBe('');
		expect(s.heldResult).toBe(null);
	});

	it('keeps the dirty flag for a value edited while the solve ran', () => {
		const s = state({ hasPendingChanges: true });
		applySolveResult(s, { outputs: {} }, true);
		expect(s.hasPendingChanges).toBe(true);
	});

	it('never raises the dirty flag in auto mode', () => {
		const s = state({ hasPendingChanges: false });
		applySolveResult(s, { outputs: {} }, true);
		expect(s.hasPendingChanges).toBe(false);
	});

	it('holds the result when the solve raised messages, and reports them regardless', () => {
		const s = state({
			values: { out: null },
			hasPendingChanges: true,
			meshes: [{ id: 'previous' }]
		});
		applySolveResult(
			s,
			{
				outputs: { out: 42 },
				errors: ['e'],
				warnings: ['w'],
				diagnostics: [gate],
				meshes: [{ id: 'm' }]
			},
			false
		);
		// Messages surface immediately — the panel needs them to render.
		expect(s.computeErrors).toEqual(['e']);
		expect(s.computeWarnings).toEqual(['w']);
		// The result itself waits: the viewer keeps showing what it had.
		expect(s.values.out).toBe(null);
		expect(s.meshes).toEqual([{ id: 'previous' }]);
		expect(s.heldResult?.outputs).toEqual({ out: 42 });
		// The inputs were solved, so they must not stay dirty and re-dispatch.
		expect(s.hasPendingChanges).toBe(false);
	});

	it('keeps the dirty flag on a held result too, for a value edited since', () => {
		const s = state({ hasPendingChanges: true });
		applySolveResult(s, { outputs: {}, diagnostics: [gate] }, true);
		expect(s.heldResult).not.toBe(null);
		expect(s.hasPendingChanges).toBe(true);
	});

	it('treats missing result arrays as empty', () => {
		const s = state();
		applySolveResult(s, { outputs: {} }, false);
		expect(s.computeErrors).toEqual([]);
		expect(s.computeWarnings).toEqual([]);
		expect(s.meshes).toEqual([]);
		expect(s.blocked).toBe(false);
	});

	it('applies a blocked solve at once, clearing the previous meshes instead of holding', () => {
		const s = state({ meshes: [{ id: 'stale' }] });
		applySolveResult(
			s,
			{ outputs: {}, errors: ['Wall too thin'], blocked: true, diagnostics: [gate] },
			false
		);
		expect(s.blocked).toBe(true);
		expect(s.computeErrors).toEqual(['Wall too thin']);
		expect(s.heldResult).toBe(null);
		expect(s.meshes).toEqual([]);
	});

	it('clears blocked once a later clean solve arrives', () => {
		const s = state();
		applySolveResult(s, { outputs: {}, errors: ['nope'], blocked: true }, false);
		applySolveResult(s, { outputs: { a: 1 } }, false);
		expect(s.blocked).toBe(false);
		expect(s.heldResult).toBe(null);
	});

	it('a newer held result replaces an older one, so confirming applies the latest', () => {
		const s = state();
		applySolveResult(s, { outputs: { out: 1 }, diagnostics: [gate] }, false);
		applySolveResult(s, { outputs: { out: 2 }, diagnostics: [gate] }, false);
		expect(s.heldResult?.outputs).toEqual({ out: 2 });
	});

	it('marks an aborted result unsolved, and the next clean one clears that', () => {
		const s = state();
		applySolveResult(s, { outputs: {}, blocked: true, aborted: true }, false);
		expect(s.unsolved).toBe('aborted');
		applySolveResult(s, { outputs: {} }, false);
		expect(s.unsolved).toBe(null);
	});
});

describe('commitSolveResult', () => {
	it('keeps meshes off the retained result', () => {
		const s = state();
		commitSolveResult(s, { outputs: {}, meshes: [{ id: 'm' }], source: 'raw' }, false);
		expect(s.lastResult).toEqual({ outputs: {}, source: 'raw' });
	});
});

describe('ensureSolvedStep', () => {
	const solved = { lastResult: { outputs: {} } };

	it('waits on a busy driver, and on a held result', () => {
		expect(ensureSolvedStep(state(solved), true)).toBe('wait');
		expect(ensureSolvedStep(state({ heldResult: { outputs: {} } }), false)).toBe('wait');
	});

	it('answers from the screen when nothing changed', () => {
		expect(ensureSolvedStep(state(solved), false)).toBe('applied');
	});

	it.each<[string, Partial<SolveSessionState>]>([
		['pending edits', { ...solved, hasPendingChanges: true }],
		['a first solve in manual mode', { ...solved, hasNeverSolved: true }],
		['a failed last solve', { ...solved, error: 'boom' }],
		['an aborted last solve', { ...solved, unsolved: 'aborted' }],
		['nothing on screen', {}]
	])('solves for %s', (_name, overrides) => {
		expect(ensureSolvedStep(state(overrides), false)).toBe('solve');
	});

	it('settles a discarded result rather than ask the user again', () => {
		expect(ensureSolvedStep(state({ ...solved, unsolved: 'discarded' }), false)).toBe('discarded');
		expect(ensureSolvedStep(state({ unsolved: 'discarded', hasNeverSolved: true }), false)).toBe(
			'discarded'
		);
	});

	it('solves an edit made after a discard', () => {
		const s = state({ ...solved, unsolved: 'discarded', hasPendingChanges: true });
		expect(ensureSolvedStep(s, false)).toBe('solve');
	});

	it('reports a refused solve as blocked', () => {
		expect(ensureSolvedStep(state({ ...solved, blocked: true }), false)).toBe('blocked');
	});
});

describe('needsAcknowledgement', () => {
	const gate = { level: 'warning' as const, message: 'check this', isGate: true };

	it('is false for a clean solve', () => {
		expect(needsAcknowledgement([])).toBe(false);
	});

	it('gates on a Message component', () => {
		expect(needsAcknowledgement([gate])).toBe(true);
	});

	it('does not gate on incidental Grasshopper warnings', () => {
		// The case that made every solve pop a dialog: a component complaining about its own
		// inputs is for whoever edits the definition, not whoever uses the app.
		expect(
			needsAcknowledgement([
				{ level: 'warning', message: 'Parameter failed to collect data', source: 'Voronoi' },
				{ level: 'error', message: '1. Solution exception: index out of range' }
			])
		).toBe(false);
	});

	it('does not gate on a remark, even an authored one', () => {
		expect(needsAcknowledgement([{ level: 'remark', message: 'fyi', isGate: true }])).toBe(false);
	});
});
