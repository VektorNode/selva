import { describe, expect, it, vi } from 'vitest';
import type { UISchema } from '@selvajs/schemas';
import { createFakeSource, type FakeSource } from '$lib/schema-source/fake-source';
import {
	createInitialBuilderState,
	handleInitialData,
	handleSchemaUpdated,
	handleSchemaSaveRejected,
	handleParametersAdded,
	handleSyncPreview,
	handleSyncApplied,
	requestSyncPreview,
	syncParameters,
	saveDraft,
	markDirty,
	discardDraft,
	type BuilderDeps,
	type BuilderNotifier
} from './builder-state-core';

// builder-state-core holds the pure transition logic behind the SchemaSource seam. These
// drive it through a FakeSource — no runes, no socket, no Grasshopper — which is the whole
// point of the seam: the state machine is now exercisable through its real interface.

const SESSION = 's1';

function plainClone(schema: UISchema): UISchema {
	return structuredClone(schema);
}

function makeNotifier(): BuilderNotifier & { calls: Record<string, string[]> } {
	const calls = {
		info: [] as string[],
		success: [] as string[],
		warning: [] as string[],
		error: [] as string[]
	};
	return {
		calls,
		info: (m) => calls.info.push(m),
		success: (m) => calls.success.push(m),
		warning: (m) => calls.warning.push(m),
		error: (m) => calls.error.push(m)
	};
}

function setup() {
	const source = createFakeSource();
	const notify = makeNotifier();
	const history = { clearHistory: vi.fn() };
	const state = createInitialBuilderState();
	const deps: BuilderDeps = { sessionId: SESSION, source, history, notify, clone: plainClone };
	return { source, notify, history, state, deps };
}

function schema(overrides: Partial<UISchema> = {}): UISchema {
	return {
		inputs: [],
		outputs: [],
		layout: { type: 'tabbed', gap: 16, tabs: [] },
		...overrides
	} as unknown as UISchema;
}

describe('handleInitialData', () => {
	it('ignores messages for a different session', () => {
		const { state, deps } = setup();
		handleInitialData(state, deps, {
			sessionId: 'other',
			type: 'initialData',
			schema: schema()
		});
		expect(state.loading).toBe(true);
		expect(state.canonical).toBeNull();
	});

	it('seeds canonical + a cloned draft and clears loading', () => {
		const { state, deps, history } = setup();
		const incoming = schema({ inputs: [{ id: 'a' }] as never });
		handleInitialData(state, deps, {
			sessionId: SESSION,
			type: 'initialData',
			schema: incoming,
			schemaHash: 'h1',
			availableParams: { inputs: [{ id: 'a' }], outputs: [] } as never
		});

		expect(state.loading).toBe(false);
		expect(state.canonical).toEqual(incoming);
		expect(state.canonicalHash).toBe('h1');
		expect(state.draft).toEqual(incoming);
		expect(state.draft).not.toBe(state.canonical); // deep clone, not aliased
		expect(state.availableInputs).toHaveLength(1);
		expect(history.clearHistory).toHaveBeenCalled();
	});

	it('errors when no params or outputs are discovered', () => {
		const { state, deps } = setup();
		handleInitialData(state, deps, { sessionId: SESSION, type: 'initialData', schema: schema() });
		expect(state.error).toMatch(/No parameters or outputs/);
	});
});

describe('handleSchemaUpdated', () => {
	it('replaces canonical and re-clones a clean draft', () => {
		const { state, deps } = setup();
		state.canonical = schema();
		state.draft = schema();
		const next = schema({ documentId: 'doc-1' } as never);

		handleSchemaUpdated(state, deps, {
			sessionId: SESSION,
			type: 'schemaUpdated',
			schema: next,
			schemaHash: 'h2'
		});

		expect(state.canonicalHash).toBe('h2');
		expect(state.draft).toEqual(next);
	});

	it('keeps a dirty draft and warns instead of clobbering edits', () => {
		const { state, deps, notify } = setup();
		state.canonical = schema();
		const userDraft = schema({ documentId: 'mine' } as never);
		state.draft = userDraft;
		state.isDirty = true;

		handleSchemaUpdated(state, deps, {
			sessionId: SESSION,
			type: 'schemaUpdated',
			schema: schema({ documentId: 'theirs' } as never)
		});

		expect(state.draft).toBe(userDraft); // untouched
		expect(notify.calls.warning).toHaveLength(1);
	});

	it('refetches initial data when the broadcast carries unknown param ids', () => {
		const { state, deps, source } = setup();
		state.availableInputs = [];
		handleSchemaUpdated(state, deps, {
			sessionId: SESSION,
			type: 'schemaUpdated',
			schema: schema({ inputs: [{ id: 'new' }] as never })
		});
		expect(source.initialDataRequests).toContain(SESSION);
	});
});

describe('handleSchemaSaveRejected', () => {
	it('adopts the server schema/hash and surfaces an error toast', () => {
		const { state, deps, notify } = setup();
		state.isDirty = true;
		const server = schema({ documentId: 'server' } as never);
		handleSchemaSaveRejected(state, deps, {
			sessionId: SESSION,
			type: 'schemaSaveRejected',
			schema: server,
			schemaHash: 'fresh',
			reason: 'stale'
		});
		expect(state.canonical).toBe(server);
		expect(state.canonicalHash).toBe('fresh');
		expect(state.isDirty).toBe(true); // user keeps their dirty draft
		expect(notify.calls.error).toContain('stale');
	});
});

describe('handleParametersAdded', () => {
	it('updates available params and flags sync needed', () => {
		const { state, deps } = setup();
		handleParametersAdded(state, deps, {
			sessionId: SESSION,
			type: 'parametersAdded',
			availableParams: { inputs: [{ id: 'x' }], outputs: [] } as never
		});
		expect(state.syncNeeded).toBe(true);
		expect(state.availableInputs).toHaveLength(1);
	});

	it('refetches when no available params are supplied', () => {
		const { state, deps, source } = setup();
		handleParametersAdded(state, deps, { sessionId: SESSION, type: 'parametersAdded' });
		expect(source.initialDataRequests).toContain(SESSION);
	});
});

describe('sync flow', () => {
	it('requestSyncPreview opens the dialog and forwards a cloned draft', () => {
		const { state, deps, source } = setup();
		state.draft = schema();
		requestSyncPreview(state, deps);
		expect(state.syncDialogOpen).toBe(true);
		expect(state.syncLoading).toBe(true);
		expect(source.syncPreviewRequests).toHaveLength(1);
		expect(source.syncPreviewRequests[0].draft).not.toBe(state.draft);
	});

	it('handleSyncPreview fills the diff and stops loading', () => {
		const { state, deps } = setup();
		state.syncLoading = true;
		handleSyncPreview(state, deps, {
			sessionId: SESSION,
			type: 'syncPreview',
			fromGH: [],
			toGH: []
		} as never);
		expect(state.syncLoading).toBe(false);
		expect(state.syncDiff).toEqual({ fromGH: [], toGH: [] });
	});

	it('handleSyncApplied closes the dialog and refetches on success', () => {
		const { state, deps, source } = setup();
		state.syncDialogOpen = true;
		handleSyncApplied(state, deps, {
			sessionId: SESSION,
			type: 'syncApplied',
			success: true
		} as never);
		expect(state.syncDialogOpen).toBe(false);
		expect(source.initialDataRequests).toContain(SESSION);
	});

	it('syncParameters clears the flag and refetches', () => {
		const { state, deps, source } = setup();
		state.syncNeeded = true;
		syncParameters(state, deps);
		expect(state.syncNeeded).toBe(false);
		expect(source.initialDataRequests).toContain(SESSION);
	});
});

describe('saveDraft', () => {
	async function resolveLastSave(source: FakeSource, ok: boolean, reason = '') {
		// wait a microtask so save()'s promise has registered before we settle it
		await Promise.resolve();
		const last = source.saves.at(-1)!;
		last.resolve(ok ? { ok: true } : { ok: false, reason });
	}

	it('clears dirty and toasts on a successful save', async () => {
		const { state, deps, source, notify } = setup();
		state.draft = schema();
		state.isDirty = true;
		state.canonicalHash = 'base';

		const pending = saveDraft(state, deps);
		await resolveLastSave(source, true);
		const result = await pending;

		expect(result).toBe(true);
		expect(state.isDirty).toBe(false);
		expect(source.saves[0].baseHash).toBe('base');
		expect(notify.calls.success).toHaveLength(1);
	});

	it('keeps dirty and toasts the reason on a rejected save', async () => {
		const { state, deps, source, notify } = setup();
		state.draft = schema();
		state.isDirty = true;

		const pending = saveDraft(state, deps);
		await resolveLastSave(source, false, 'stale base');
		const result = await pending;

		expect(result).toBe(false);
		expect(state.isDirty).toBe(true);
		expect(notify.calls.error.some((m) => m.includes('stale base'))).toBe(true);
	});

	it('refuses to save when disconnected', async () => {
		const { state, deps, source, notify } = setup();
		state.draft = schema();
		source.setConnected(false);

		const result = await saveDraft(state, deps);
		expect(result).toBe(false);
		expect(source.saves).toHaveLength(0);
		expect(notify.calls.error.some((m) => m.includes('Not connected'))).toBe(true);
	});
});

describe('markDirty / discardDraft', () => {
	it('markDirty flips the flag once', () => {
		const { state } = setup();
		markDirty(state);
		expect(state.isDirty).toBe(true);
	});

	it('discardDraft re-clones canonical and clears dirty', () => {
		const { state, deps, history } = setup();
		state.canonical = schema({ documentId: 'canon' } as never);
		state.draft = schema({ documentId: 'edited' } as never);
		state.isDirty = true;

		discardDraft(state, deps);

		expect(state.draft).toEqual(state.canonical);
		expect(state.draft).not.toBe(state.canonical);
		expect(state.isDirty).toBe(false);
		expect(history.clearHistory).toHaveBeenCalled();
	});
});
