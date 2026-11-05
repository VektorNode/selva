// Reactive shell over builder-state-core.ts. It owns the $state object and the live
// SchemaSource, wires the source's push events to the pure handlers, and exposes the
// imperative API the route uses. All decision logic lives in the core; this file is
// delegation + rune plumbing only.

import { toast } from '@selvajs/ui';
import type { UISchema } from '@selvajs/schemas';
import { getWebSocketPortFromUrl } from '#lib/utils/session.js';
import { getGrasshopperSource } from '#lib/schema-source/grasshopper-source.js';
import type { SchemaSource } from '#lib/schema-source/schema-source.js';
import type { SyncChange } from '#lib/websocket/websocket.svelte.js';
import { useSchemaHistory } from './useSchemaHistory.svelte';
import { draftPlacements } from '#lib/features/builder/operations.js';
import {
	createInitialBuilderState,
	markDirty as coreMarkDirty,
	editDraft as coreEditDraft,
	discardDraft as coreDiscardDraft,
	handleOutputs as coreHandleOutputs,
	handleInitialData as coreHandleInitialData,
	handleMetadataUpdated as coreHandleMetadataUpdated,
	handleSchemaUpdated as coreHandleSchemaUpdated,
	handleSchemaSaveRejected as coreHandleSchemaSaveRejected,
	handleParametersAdded as coreHandleParametersAdded,
	handleSyncPreview as coreHandleSyncPreview,
	handleSyncApplied as coreHandleSyncApplied,
	handleLayoutPlaced as coreHandleLayoutPlaced,
	handleCanvasSelection as coreHandleCanvasSelection,
	handleRevealItem as coreHandleRevealItem,
	placeParamsInGroup as corePlaceParamsInGroup,
	syncParameters as coreSyncParameters,
	requestSyncPreview as coreRequestSyncPreview,
	applySyncChanges as coreApplySyncChanges,
	saveDraft as coreSaveDraft,
	type BuilderState,
	type BuilderDeps
} from './builder-state-core';

function clone(schema: UISchema): UISchema {
	// `$state.snapshot` unwraps any Svelte 5 reactive proxy. structuredClone throws
	// DataCloneError on a raw proxy (e.g. when cloning state.canonical for discardDraft), so
	// the snapshot is required even on the fast path.
	const plain = $state.snapshot(schema) as UISchema;
	return typeof structuredClone === 'function'
		? (structuredClone(plain) as UISchema)
		: (JSON.parse(JSON.stringify(plain)) as UISchema);
}

/**
 * @param source Defaults to the Grasshopper WebSocket source bound to the URL's wsPort.
 *   Tests inject a FakeSource to exercise the state machine without a live socket.
 */
export function useBuilderState(sessionId: string, source?: SchemaSource) {
	const schemaSource = source ?? getGrasshopperSource(getWebSocketPortFromUrl());
	const history = useSchemaHistory();

	const state = $state<BuilderState>(createInitialBuilderState());

	const deps: BuilderDeps = {
		sessionId,
		source: schemaSource,
		history,
		notify: toast,
		clone
	};

	// Bound handlers — stable references so on/off pair up across initialize/cleanup.
	const onOutputs = (m: Parameters<typeof coreHandleOutputs>[2]) =>
		coreHandleOutputs(state, deps, m);
	const onInitialData = (m: Parameters<typeof coreHandleInitialData>[2]) => {
		coreHandleInitialData(state, deps, m);
		// A reconnected plugin has forgotten the draft it was last told about.
		draftLayoutSent = undefined;
		publishDraftLayout();
	};
	const onMetadataUpdated = (m: Parameters<typeof coreHandleMetadataUpdated>[2]) =>
		coreHandleMetadataUpdated(state, deps, m);
	const onSchemaUpdated = (m: Parameters<typeof coreHandleSchemaUpdated>[2]) =>
		coreHandleSchemaUpdated(state, deps, m);
	const onSchemaSaveRejected = (m: Parameters<typeof coreHandleSchemaSaveRejected>[2]) =>
		coreHandleSchemaSaveRejected(state, deps, m);
	const onParametersAdded = (m: Parameters<typeof coreHandleParametersAdded>[2]) =>
		coreHandleParametersAdded(state, deps, m);
	const onSyncPreview = (m: Parameters<typeof coreHandleSyncPreview>[2]) =>
		coreHandleSyncPreview(state, deps, m);
	const onSyncApplied = (m: Parameters<typeof coreHandleSyncApplied>[2]) =>
		coreHandleSyncApplied(state, deps, m);
	const onLayoutPlaced = (m: Parameters<typeof coreHandleLayoutPlaced>[2]) =>
		coreHandleLayoutPlaced(state, deps, m);
	const onCanvasSelection = (m: Parameters<typeof coreHandleCanvasSelection>[2]) =>
		coreHandleCanvasSelection(state, deps, m);
	const onRevealItem = (m: Parameters<typeof coreHandleRevealItem>[2]) =>
		coreHandleRevealItem(state, deps, m);

	let initialized = false;

	// What the plugin was last told, as JSON; undefined when it has not been told anything yet.
	let draftLayoutSent: string | undefined;
	const NO_DRAFT = JSON.stringify(null);

	/**
	 * Sends where the unsaved draft places each param, so the canvas labels follow the editor
	 * before a save. Reads the draft, so calling it from an $effect re-sends on every edit.
	 */
	function publishDraftLayout() {
		const placements = state.isDirty && state.draft ? draftPlacements(state.draft) : null;
		const key = JSON.stringify(placements);
		if (key === draftLayoutSent || !schemaSource.connected) return;
		draftLayoutSent = key;
		schemaSource.sendDraftLayout(sessionId, placements);
	}

	/** Connect the source, subscribe to push events, and pull the first schema. */
	async function initialize() {
		if (initialized) return;
		initialized = true;

		schemaSource.on('outputs', onOutputs);
		schemaSource.on('initialData', onInitialData);
		schemaSource.on('metadataUpdated', onMetadataUpdated);
		schemaSource.on('schemaUpdated', onSchemaUpdated);
		schemaSource.on('schemaSaveRejected', onSchemaSaveRejected);
		schemaSource.on('parametersAdded', onParametersAdded);
		schemaSource.on('syncPreview', onSyncPreview);
		schemaSource.on('syncApplied', onSyncApplied);
		schemaSource.on('layoutPlaced', onLayoutPlaced);
		schemaSource.on('canvasSelection', onCanvasSelection);
		schemaSource.on('revealItem', onRevealItem);

		const result = await schemaSource.connect(sessionId);
		if (!result.ok) {
			state.error = result.error;
			state.loading = false;
			return;
		}

		schemaSource.requestInitialData(sessionId);
	}

	function cleanup() {
		if (!initialized) return;
		initialized = false;
		if (draftLayoutSent !== undefined && draftLayoutSent !== NO_DRAFT && schemaSource.connected)
			schemaSource.sendDraftLayout(sessionId, null);
		draftLayoutSent = undefined;

		schemaSource.off('outputs', onOutputs);
		schemaSource.off('initialData', onInitialData);
		schemaSource.off('metadataUpdated', onMetadataUpdated);
		schemaSource.off('schemaUpdated', onSchemaUpdated);
		schemaSource.off('schemaSaveRejected', onSchemaSaveRejected);
		schemaSource.off('parametersAdded', onParametersAdded);
		schemaSource.off('syncPreview', onSyncPreview);
		schemaSource.off('syncApplied', onSyncApplied);
		schemaSource.off('layoutPlaced', onLayoutPlaced);
		schemaSource.off('canvasSelection', onCanvasSelection);
		schemaSource.off('revealItem', onRevealItem);
	}

	return {
		get state() {
			return state;
		},
		get source() {
			return schemaSource;
		},
		/** Whether the underlying transport can currently carry saves/commands. */
		get connected() {
			return schemaSource.connected;
		},
		history,
		syncParameters: () => coreSyncParameters(state, deps),
		requestSyncPreview: () => coreRequestSyncPreview(state, deps),
		applySyncChanges: (changes: SyncChange[]) => coreApplySyncChanges(state, deps, changes),
		save: () => coreSaveDraft(state, deps),
		markDirty: () => coreMarkDirty(state),
		editDraft: (apply: () => void, coalesceKey?: string) =>
			coreEditDraft(state, deps, apply, coalesceKey),
		discardDraft: () => coreDiscardDraft(state, deps),
		placeParamsInGroup: (groupId: string, paramIds: string[]) =>
			corePlaceParamsInGroup(state, deps, groupId, paramIds),
		publishDraftLayout,
		initialize,
		cleanup
	};
}
