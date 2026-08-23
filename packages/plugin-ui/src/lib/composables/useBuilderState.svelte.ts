// Reactive shell over builder-state-core.ts. It owns the $state object and the live
// SchemaSource, wires the source's push events to the pure handlers, and exposes the
// imperative API the route uses. All decision logic lives in the core; this file is
// delegation + rune plumbing only.

import { toast } from '@selvajs/ui';
import type { UISchema } from '@selvajs/schemas';
import { getWebSocketPortFromUrl } from '$lib/utils/session';
import { getGrasshopperSource } from '$lib/schema-source/grasshopper-source';
import type { SchemaSource } from '$lib/schema-source/schema-source';
import type { SyncChange } from '$lib/websocket/websocket.svelte';
import { useSchemaHistory } from './useSchemaHistory.svelte';
import {
	createInitialBuilderState,
	markDirty as coreMarkDirty,
	discardDraft as coreDiscardDraft,
	handleOutputs as coreHandleOutputs,
	handleInitialData as coreHandleInitialData,
	handleMetadataUpdated as coreHandleMetadataUpdated,
	handleSchemaUpdated as coreHandleSchemaUpdated,
	handleSchemaSaveRejected as coreHandleSchemaSaveRejected,
	handleParametersAdded as coreHandleParametersAdded,
	handleSyncPreview as coreHandleSyncPreview,
	handleSyncApplied as coreHandleSyncApplied,
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
	const onInitialData = (m: Parameters<typeof coreHandleInitialData>[2]) =>
		coreHandleInitialData(state, deps, m);
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

	let initialized = false;

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

		schemaSource.off('outputs', onOutputs);
		schemaSource.off('initialData', onInitialData);
		schemaSource.off('metadataUpdated', onMetadataUpdated);
		schemaSource.off('schemaUpdated', onSchemaUpdated);
		schemaSource.off('schemaSaveRejected', onSchemaSaveRejected);
		schemaSource.off('parametersAdded', onParametersAdded);
		schemaSource.off('syncPreview', onSyncPreview);
		schemaSource.off('syncApplied', onSyncApplied);
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
		discardDraft: () => coreDiscardDraft(state, deps),
		initialize,
		cleanup
	};
}
