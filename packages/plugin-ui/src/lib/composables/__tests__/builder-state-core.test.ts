import { describe, expect, it, vi } from 'vitest';
import type { UISchema } from '@selvajs/schemas';
import { createFakeSource, type FakeSource } from '#lib/schema-source/fake-source.js';
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
	editDraft,
	discardDraft,
	handleLayoutPlaced,
	handleCanvasSelection,
	handleRevealItem,
	placeParamsInGroup,
	type BuilderDeps,
	type BuilderNotifier
} from '../builder-state-core';

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
	const history = { push: vi.fn(), clearHistory: vi.fn() };
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

	it('sends a copy of the draft as edited', async () => {
		const { state, deps, source } = setup();
		state.draft = schema({
			inputs: [{ id: 'in-a', paramType: 'number', default: 1 }],
			outputs: [{ id: 'out-a', paramType: 'number' }],
			layout: {
				type: 'tabbed',
				gap: 16,
				tabs: [{ id: 't', label: 'Main', groups: [{ id: 'g', items: [] }] }]
			}
		} as unknown as Partial<UISchema>);
		markDirty(state);

		const pending = saveDraft(state, deps);
		await resolveLastSave(source, true);
		await pending;

		expect(source.saves[0].draft).toEqual(state.draft);
		// A copy, so an edit made while the save is in flight can't change what was sent.
		expect(source.saves[0].draft).not.toBe(state.draft);
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

	it('keeps dirty when the draft was edited while the save was in flight', async () => {
		const { state, deps, source, notify } = setup();
		state.draft = schema();
		markDirty(state);

		const pending = saveDraft(state, deps);
		markDirty(state);
		await resolveLastSave(source, true);
		const result = await pending;

		expect(result).toBe(true);
		expect(state.isDirty).toBe(true);
		expect(notify.calls.success).toHaveLength(1);
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

	it('editDraft snapshots the draft before the edit, then marks it dirty', () => {
		const { state, deps, history } = setup();
		state.draft = schema({ documentId: 'before' } as never);

		editDraft(state, deps, () => (state.draft!.documentId = 'after'), 'doc-id');

		expect(history.push).toHaveBeenCalledWith(
			expect.objectContaining({ documentId: 'before' }),
			'doc-id'
		);
		expect(state.draft.documentId).toBe('after');
		expect(state.isDirty).toBe(true);
	});

	it('editDraft does nothing before a draft exists', () => {
		const { state, deps, history } = setup();
		const apply = vi.fn();

		editDraft(state, deps, apply);

		expect(apply).not.toHaveBeenCalled();
		expect(history.push).not.toHaveBeenCalled();
		expect(state.isDirty).toBe(false);
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

describe('canvas placement', () => {
	// Draft: tab t1 with group g1 holding a and b. c is discovered but unplaced.
	function layoutSchema(): UISchema {
		return schema({
			inputs: [
				{ id: 'a', nickname: 'A', paramType: 'number' },
				{ id: 'b', nickname: 'B', paramType: 'number' },
				{ id: 'c', nickname: 'C', paramType: 'number' }
			] as never,
			layout: {
				type: 'tabbed',
				gap: 16,
				tabs: [
					{
						id: 't1',
						label: 'General',
						icon: '',
						groups: [
							{
								id: 'g1',
								label: 'Size',
								columns: 1,
								items: [
									{
										id: 'item-a',
										type: 'input',
										paramId: 'a',
										displayName: 'A',
										widgetType: 'number'
									},
									{
										id: 'item-b',
										type: 'input',
										paramId: 'b',
										displayName: 'B',
										widgetType: 'number'
									}
								]
							},
							{ id: 'g2', label: 'Other', columns: 1, items: [] }
						]
					}
				]
			} as never
		});
	}

	function ready() {
		const ctx = setup();
		ctx.state.availableInputs = ['a', 'b', 'c'].map((id) => ({
			id,
			name: id.toUpperCase(),
			nickname: id.toUpperCase(),
			type: 'number',
			description: ''
		})) as never;
		ctx.state.canonical = layoutSchema();
		ctx.state.canonicalHash = 'h1';
		ctx.state.draft = layoutSchema();
		return ctx;
	}

	function groupsOf(s: UISchema | null) {
		if (s?.layout.type !== 'tabbed') throw new Error('expected tabbed');
		return s.layout.tabs.flatMap((t) => t.groups);
	}
	const paramIdsIn = (s: UISchema | null, groupId: string) =>
		groupsOf(s)
			.find((g) => g.id === groupId)!
			.items.map((i) => (i.type === 'linebreak' ? '' : i.paramId));

	function placed(overrides: Partial<Parameters<typeof handleLayoutPlaced>[2]> = {}) {
		return {
			type: 'layoutPlaced',
			sessionId: SESSION,
			schema: layoutSchema(),
			schemaHash: 'h2',
			placements: [
				{
					paramId: 'c',
					itemType: 'input',
					tabId: 't1',
					tabLabel: 'General',
					groupId: 'g-new',
					groupLabel: 'Depth'
				},
				{
					paramId: 'a',
					itemType: 'input',
					tabId: 't1',
					tabLabel: 'General',
					groupId: 'g-new',
					groupLabel: 'Depth'
				}
			],
			removedIds: [],
			summary: 'Added C, A to General › Depth',
			...overrides
		} as Parameters<typeof handleLayoutPlaced>[2];
	}

	it('replays onto a dirty draft that has not diverged, as one history step', () => {
		const { state, deps, history, notify } = ready();
		editDraft(state, deps, () => (groupsOf(state.draft)[0].label = 'My edit'));
		history.push.mockClear();

		handleLayoutPlaced(state, deps, placed());

		expect(history.push).toHaveBeenCalledTimes(1);
		expect(groupsOf(state.draft)[0].label).toBe('My edit');
		const created = groupsOf(state.draft).find((g) => g.id === 'g-new')!;
		expect(created.label).toBe('Depth');
		expect(paramIdsIn(state.draft, 'g-new')).toEqual(['c', 'a']);
		// a moved, keeping its layout item.
		expect(paramIdsIn(state.draft, 'g1')).toEqual(['b']);
		expect(created.items[1].id).toBe('item-a');
		expect(state.canonicalHash).toBe('h2');
		expect(state.isDirty).toBe(true);
		expect(state.divergedSinceFork).toBe(false);
		expect(notify.calls.success).toEqual(['Added C, A to General › Depth']);
		expect(notify.calls.warning).toHaveLength(0);
		expect(state.activeTabId).toBe('t1');
		expect(state.spotlight?.itemIds).toHaveLength(2);
	});

	it('creates a missing tab with the given id and label', () => {
		const { state, deps } = ready();
		markDirty(state);
		handleLayoutPlaced(
			state,
			deps,
			placed({
				placements: [
					{
						paramId: 'c',
						itemType: 'input',
						tabId: 't-new',
						tabLabel: 'Extra',
						groupId: 'g-x',
						groupLabel: 'X'
					}
				]
			})
		);
		const layout = state.draft!.layout as Extract<UISchema['layout'], { type: 'tabbed' }>;
		expect(layout.tabs.at(-1)).toMatchObject({ id: 't-new', label: 'Extra' });
		expect(layout.tabs.at(-1)!.groups.map((g) => g.id)).toEqual(['g-x']);
		expect(state.activeTabId).toBe('t-new');
	});

	it('removes the layout items of removedIds but keeps the params', () => {
		const { state, deps } = ready();
		markDirty(state);
		handleLayoutPlaced(state, deps, placed({ placements: [], removedIds: ['b'] }));
		expect(paramIdsIn(state.draft, 'g1')).toEqual(['a']);
		expect(state.draft!.inputs.some((i) => i.id === 'b')).toBe(true);
	});

	it('copies a new param’s layout item from the plugin’s canonical, keeping its config', () => {
		const { state, deps } = ready();
		markDirty(state);
		const committed = layoutSchema();
		committed.outputs = [
			{ id: 'dvl', nickname: 'Pick', type: 'dynamicValueList', targetInputId: 'a' }
		] as never;
		groupsOf(committed)[1].items = [
			{
				id: 'item-dvl',
				type: 'output',
				paramId: 'dvl',
				displayName: 'Pick',
				widgetType: 'dynamicValueList',
				config: { targetInputId: 'a' }
			} as never
		];
		handleLayoutPlaced(
			state,
			deps,
			placed({
				schema: committed,
				placements: [
					{
						paramId: 'dvl',
						itemType: 'output',
						tabId: 't1',
						tabLabel: 'General',
						groupId: 'g2',
						groupLabel: 'Other'
					}
				]
			})
		);
		const item = groupsOf(state.draft).find((g) => g.id === 'g2')!.items[0];
		expect(item).toMatchObject({ paramId: 'dvl', config: { targetInputId: 'a' } });
		expect(item).not.toBe(groupsOf(committed)[1].items[0]);
		expect(state.draft!.outputs).toContainEqual(
			expect.objectContaining({ id: 'dvl', targetInputId: 'a' })
		);
	});

	it('falls back to the dirty warning when the draft has diverged', () => {
		const { state, deps, notify } = ready();
		markDirty(state);
		handleSchemaUpdated(state, deps, {
			sessionId: SESSION,
			type: 'schemaUpdated',
			schema: layoutSchema(),
			schemaHash: 'h-other'
		});
		expect(state.divergedSinceFork).toBe(true);
		const before = structuredClone(state.draft);

		handleLayoutPlaced(state, deps, placed());

		expect(state.draft).toEqual(before);
		expect(state.canonicalHash).toBe('h2');
		expect(notify.calls.warning.length).toBeGreaterThan(0);
		expect(notify.calls.success).toContain('Added C, A to General › Depth');
	});

	it('replaces a clean draft with the plugin canonical', () => {
		const { state, deps } = ready();
		const next = layoutSchema();
		groupsOf(next)[1].items = [
			{ id: 'item-c', type: 'input', paramId: 'c', displayName: 'C', widgetType: 'number' } as never
		];

		handleLayoutPlaced(
			state,
			deps,
			placed({
				schema: next,
				placements: [
					{
						paramId: 'c',
						itemType: 'input',
						tabId: 't1',
						tabLabel: 'General',
						groupId: 'g2',
						groupLabel: 'Other'
					}
				]
			})
		);

		expect(state.draft).toEqual(next);
		expect(state.draft).not.toBe(next);
		expect(state.isDirty).toBe(false);
		expect(state.canonicalHash).toBe('h2');
		expect(state.spotlight?.itemIds).toEqual(['item-c']);
	});

	it('refetches discovery when the schema names an unknown param', () => {
		const { state, deps, source } = ready();
		const next = layoutSchema();
		next.inputs.push({ id: 'new', nickname: 'New', paramType: 'number' } as never);
		handleLayoutPlaced(state, deps, placed({ schema: next, placements: [] }));
		expect(source.initialDataRequests).toEqual([SESSION]);
	});

	it('a discard or a save clears divergence', async () => {
		const { state, deps, source } = ready();
		markDirty(state);
		handleSchemaSaveRejected(state, deps, {
			sessionId: SESSION,
			type: 'schemaSaveRejected',
			schema: layoutSchema(),
			schemaHash: 'h3'
		});
		expect(state.divergedSinceFork).toBe(true);
		discardDraft(state, deps);
		expect(state.divergedSinceFork).toBe(false);

		markDirty(state);
		state.divergedSinceFork = true;
		const pending = saveDraft(state, deps);
		await Promise.resolve();
		source.saves.at(-1)!.resolve({ ok: true });
		await pending;
		expect(state.divergedSinceFork).toBe(false);
	});

	it('stores the canvas selection', () => {
		const { state, deps } = ready();
		handleCanvasSelection(state, deps, {
			sessionId: SESSION,
			type: 'canvasSelection',
			ids: ['c', 'a']
		});
		expect(state.canvasSelection).toEqual(['c', 'a']);
	});

	it('reveals a placed param on its tab', () => {
		const { state, deps, notify } = ready();
		state.activeTabId = null;
		handleRevealItem(state, deps, { sessionId: SESSION, type: 'revealItem', paramId: 'b' });
		expect(state.activeTabId).toBe('t1');
		expect(state.spotlight?.itemIds).toEqual(['item-b']);

		handleRevealItem(state, deps, { sessionId: SESSION, type: 'revealItem', paramId: 'c' });
		expect(notify.calls.info).toHaveLength(1);
	});

	it('Add here moves placed params and adds new ones as one step', () => {
		const { state, deps, history } = ready();

		const count = placeParamsInGroup(state, deps, 'g2', ['c', 'a', 'unknown']);

		expect(count).toBe(2);
		expect(history.push).toHaveBeenCalledTimes(1);
		expect(paramIdsIn(state.draft, 'g2')).toEqual(['c', 'a']);
		expect(paramIdsIn(state.draft, 'g1')).toEqual(['b']);
		expect(state.isDirty).toBe(true);
	});

	it('Add here skips params already in the group', () => {
		const { state, deps, history } = ready();
		expect(placeParamsInGroup(state, deps, 'g1', ['a', 'b'])).toBe(0);
		expect(history.push).not.toHaveBeenCalled();
		expect(paramIdsIn(state.draft, 'g1')).toEqual(['a', 'b']);
	});
});
