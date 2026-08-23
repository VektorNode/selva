import { describe, expect, it } from 'vitest';
import type { UISchema } from '@selvajs/schemas';
import {
	createInitialPreviewState,
	handleInitialData,
	handleCurrentValues,
	handleOutputUpdate,
	handleSchemaUpdated,
	handleMetadataUpdated,
	handleParametersAdded,
	clearSyncNeeded,
	type PreviewDeps,
	type PreviewSession,
	type PreviewNotifier
} from '../preview-state-core';

// preview-state-core holds the schema/notification transitions behind the seam; values and
// the solve loop live in a SolveSession, modelled here by a tiny fake. No runes, no socket.

const SESSION = 's1';

function makeNotifier(): PreviewNotifier & { messages: string[] } {
	const messages: string[] = [];
	return { messages, show: (m) => messages.push(m) };
}

function makeSession(initial: Record<string, unknown> = {}): PreviewSession & {
	loaded: Record<string, unknown>[];
	rebuilt: { schema: UISchema; scopeKey: string }[];
} {
	const values = { ...initial };
	const loaded: Record<string, unknown>[] = [];
	const rebuilt: { schema: UISchema; scopeKey: string }[] = [];
	return {
		values,
		loaded,
		rebuilt,
		loadValues: (incoming) => {
			Object.assign(values, incoming);
			loaded.push(incoming);
		},
		rebuild: (schema, scopeKey) => rebuilt.push({ schema, scopeKey })
	};
}

function setup(sessionValues: Record<string, unknown> = {}) {
	const session = makeSession(sessionValues);
	const notify = makeNotifier();
	const state = createInitialPreviewState();
	const deps: PreviewDeps = { sessionId: SESSION, session, notify };
	return { session, notify, state, deps };
}

function schema(overrides: Partial<UISchema> = {}): UISchema {
	return {
		inputs: [{ id: 'a', paramType: 'number' }],
		outputs: [{ id: 'out' }],
		layout: { type: 'tabbed', gap: 16, tabs: [] },
		...overrides
	} as unknown as UISchema;
}

describe('handleInitialData', () => {
	it('ignores a different session', () => {
		const { state, deps, session } = setup();
		handleInitialData(state, deps, { sessionId: 'other', type: 'initialData', schema: schema() });
		expect(state.loading).toBe(true);
		expect(session.loaded).toHaveLength(0);
	});

	it('errors when no schema is configured', () => {
		const { state, deps } = setup();
		handleInitialData(state, deps, { sessionId: SESSION, type: 'initialData' });
		expect(state.error).toMatch(/No schema configured/);
		expect(state.loading).toBe(false);
	});

	it('sets the schema, clears loading, and seeds the session via loadValues', () => {
		const { state, deps, session } = setup();
		handleInitialData(state, deps, {
			sessionId: SESSION,
			type: 'initialData',
			schema: schema(),
			availableParams: { inputs: [{ id: 'a', default: 5 }], outputs: [] } as never
		});
		expect(state.loading).toBe(false);
		expect(state.schema).not.toBeNull();
		expect(session.loaded).toHaveLength(1);
		expect(session.values.a).toBe(5); // availableParam default seeded
		expect(session.values.out).toBeNull(); // output seeded null
	});
});

describe('handleCurrentValues', () => {
	it('merges remote values without seeding a solve', () => {
		const { state, deps, session } = setup({ a: 1 });
		handleCurrentValues(state, deps, {
			sessionId: SESSION,
			type: 'currentValues',
			values: { a: 9, b: 2 }
		});
		expect(session.values).toEqual({ a: 9, b: 2 });
		expect(session.loaded).toHaveLength(0); // merge, not loadValues
	});
});

describe('handleOutputUpdate', () => {
	it('merges only values matching schema outputs', () => {
		const { state, deps, session } = setup({ out: null });
		state.schema = schema();
		handleOutputUpdate(state, deps, {
			sessionId: SESSION,
			type: 'outputUpdate',
			outputs: { out: 42, stray: 'ignored' }
		});
		expect(session.values.out).toBe(42);
		expect('stray' in session.values).toBe(false);
	});
});

describe('handleSchemaUpdated', () => {
	it('prunes removed params from session values and notifies', () => {
		const { state, deps, session, notify } = setup({ a: 1, gone: 2 });
		handleSchemaUpdated(state, deps, {
			sessionId: SESSION,
			type: 'schemaUpdated',
			schema: schema(),
			removedIds: ['gone']
		});
		expect('gone' in session.values).toBe(false);
		expect(session.values.a).toBe(1);
		expect(notify.messages.some((m) => m.includes('removed'))).toBe(true);
		expect(state.schema).not.toBeNull();
	});

	it('updates the schema without notifying when nothing was removed', () => {
		const { state, deps, notify } = setup();
		handleSchemaUpdated(state, deps, {
			sessionId: SESSION,
			type: 'schemaUpdated',
			schema: schema()
		});
		expect(state.schema).not.toBeNull();
		expect(notify.messages).toHaveLength(0);
	});
});

describe('handleMetadataUpdated', () => {
	it('applies metadata changes to the live schema and notifies', () => {
		const { state, deps, notify } = setup();
		state.schema = schema({ inputs: [{ id: 'a', nickname: 'Old', paramType: 'number' }] as never });
		handleMetadataUpdated(state, deps, {
			sessionId: SESSION,
			type: 'metadataUpdated',
			changedParams: [{ id: 'a', nickname: 'New' }]
		});
		expect(state.schema!.inputs[0].nickname).toBe('New');
		expect(notify.messages).toHaveLength(1);
	});

	it('no-ops when there is no schema yet', () => {
		const { state, deps, notify } = setup();
		handleMetadataUpdated(state, deps, {
			sessionId: SESSION,
			type: 'metadataUpdated',
			changedParams: [{ id: 'a', nickname: 'New' }]
		});
		expect(notify.messages).toHaveLength(0);
	});
});

describe('handleParametersAdded', () => {
	it('flags sync needed and notifies', () => {
		const { state, deps, notify } = setup();
		handleParametersAdded(state, deps, { sessionId: SESSION, type: 'parametersAdded' });
		expect(state.syncNeeded).toBe(true);
		expect(notify.messages).toHaveLength(1);
	});
});

describe('clearSyncNeeded', () => {
	it('lowers the flag', () => {
		const { state } = setup();
		state.syncNeeded = true;
		clearSyncNeeded(state);
		expect(state.syncNeeded).toBe(false);
	});
});
