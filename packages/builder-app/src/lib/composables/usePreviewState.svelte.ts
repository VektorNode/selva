import type { UISchema, SupportedTypes } from '@selvajs/schemas';
import { getWebSocketPortFromUrl, initializeWebSocketSession, ensureSchemaLayoutDefaults } from '$lib/utils/session';
import { getWebSocketState } from '$lib/websocket/websocket.svelte';
import type {
	WsInitialDataMessage,
	WsOutputsMessage,
	WsSchemaUpdatedMessage,
	WsMetadataUpdatedMessage,
	WsSessionMessage,
	WsCurrentValuesMessage
} from '$lib/websocket/websocket.svelte';
import {
	initializeValues,
	processOutputUpdate,
	updateParameterMetadata,
	removeParametersFromValues
} from '$lib/features/preview/handlers';
import {
	createNotificationManager,
	formatParameterUpdateMessage,
	formatMetadataUpdateMessage
} from '$lib/features/preview/notifications.svelte';
import { parseMeshBatchObject, SCALE_FACTORS } from '@selvajs/compute/visualization';
import type { MeshBatch } from '@selvajs/compute/visualization';
import type * as THREE from 'three';

interface PreviewState {
	schema: UISchema | null;
	values: Record<string, unknown>;
	loading: boolean;
	error: string;
	syncNeeded: boolean;
	displayMeshes: THREE.Mesh[];
	modelUnits: string;
	hasPendingChanges: boolean;
}

export function usePreviewState(getSessionId: () => string) {
	const wsPort = getWebSocketPortFromUrl();
	const wsState = getWebSocketState(wsPort);

	const state = $state<PreviewState>({
		schema: null,
		values: {},
		loading: true,
		error: '',
		syncNeeded: false,
		displayMeshes: [],
		modelUnits: 'Meters',
		hasPendingChanges: false
	});

	const { manager: notification, getMessage: getNotification } = createNotificationManager();

	let isRemoteUpdate = false;
	let initialSolveTriggered = false;
	let solveTimeout: ReturnType<typeof setTimeout> | null = null;
	let initialized = false;
	// Monotonic token: each handleOutputs call grabs a fresh value, and only
	// commits its parsed meshes if no newer call has started in the meantime.
	// Prevents stale initialData mesh parsing from clobbering live outputs.
	let outputsToken = 0;

	// Strip file metadata objects — Grasshopper already has the file
	function prepareValuesForSend(values: Record<string, unknown>): Record<string, unknown> {
		const prepared: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(values)) {
			let parsed = value;
			if (typeof value === 'string' && value.trim().startsWith('{')) {
				try { parsed = JSON.parse(value); } catch { /* keep as string */ }
			}
			if (parsed && typeof parsed === 'object' && '_isMetadata' in parsed && (parsed as Record<string, unknown>)._isMetadata === true) continue;
			prepared[key] = value;
		}
		return prepared;
	}

	function handleValueChange(paramId: string, value: SupportedTypes) {
		if (isRemoteUpdate) return;
		state.values[paramId] = value;

		if (state.schema?.instanceSolve === false) {
			state.hasPendingChanges = true;
			return;
		}

		if (wsState.connected) {
			wsState.sendValueUpdate(getSessionId(), prepareValuesForSend($state.snapshot(state.values)));
		} else {
			console.warn('[Preview] Cannot send values - WebSocket not connected');
		}
	}

	function handleCalculate() {
		if (!state.hasPendingChanges) return;
		if (wsState.connected) {
			wsState.sendValueUpdate(getSessionId(), prepareValuesForSend($state.snapshot(state.values)));
			state.hasPendingChanges = false;
		} else {
			console.warn('[Preview] Cannot calculate - WebSocket not connected');
		}
	}

	function syncParameters() {
		state.syncNeeded = false;
		initialSolveTriggered = false;
		wsState.requestInitialData(getSessionId());
		notification.show('Syncing parameters...');
	}

	async function handleOutputs(message: WsOutputsMessage) {
		const sessionId = getSessionId();
		if (message.sessionId !== sessionId) return;

		const myToken = ++outputsToken;

		if (message.modelUnits) state.modelUnits = message.modelUnits;

		if (message.displayData) {
			try {
				const dataArray = Array.isArray(message.displayData) ? message.displayData : [message.displayData];
				const scaleFactor = SCALE_FACTORS[state.modelUnits as keyof typeof SCALE_FACTORS] ?? 1;
				const allMeshes: THREE.Mesh[] = [];
				for (const batchData of dataArray as MeshBatch[]) {
					const meshes = await parseMeshBatchObject(batchData, { mergeByMaterial: false, applyTransforms: true, scaleFactor, debug: false });
					allMeshes.push(...meshes);
				}
				// Drop the result if a newer outputs message has started parsing
				if (myToken === outputsToken) state.displayMeshes = allMeshes;
			} catch (err) {
				console.error('[Preview] Error parsing display data:', err);
			}
		}

		const allUpdates = processOutputUpdate({ outputs: message.outputs, fileOutputs: message.fileOutputs, schema: state.schema });
		if (Object.keys(allUpdates).length > 0) {
			try { isRemoteUpdate = true; Object.assign(state.values, allUpdates); } finally { isRemoteUpdate = false; }
		}
	}

	async function handleInitialData(message: WsInitialDataMessage) {
		const sessionId = getSessionId();
		if (message.sessionId !== sessionId) return;

		if (!message.schema) {
			state.error = 'No schema configured. Please use the Schema Builder to create a UI.';
			state.loading = false;
			return;
		}

		const processedSchema = ensureSchemaLayoutDefaults(message.schema);
		if (!processedSchema) {
			state.error = 'Failed to process schema.';
			state.loading = false;
			return;
		}

		const newValues = initializeValues({ schema: processedSchema, availableParams: message.availableParams, currentValues: message.currentValues });

		try { isRemoteUpdate = true; state.values = newValues; } finally { isRemoteUpdate = false; }

		state.schema = processedSchema;

		const hasOutputs = message.outputs && Object.keys(message.outputs).length > 0;
		const hasDisplayData = message.displayData && (Array.isArray(message.displayData) ? message.displayData.length > 0 : true);

		if (hasOutputs || hasDisplayData) {
			// Await so loading flips off only after meshes/outputs are populated
			await handleOutputs(message as WsOutputsMessage);
			state.loading = false;
		} else if (!message.isSolving) {
			state.loading = false;
			solveTimeout = setTimeout(() => {
				if (wsState.connected && !initialSolveTriggered) {
					initialSolveTriggered = true;
					wsState.send('valueUpdate', { sessionId, values: prepareValuesForSend($state.snapshot(newValues)) });
				}
			}, 500);
		} else {
			state.loading = false;
			initialSolveTriggered = true;
		}
	}

	function handleCurrentValues(message: WsCurrentValuesMessage) {
		if (message.sessionId !== getSessionId()) return;
		try { isRemoteUpdate = true; Object.assign(state.values, message.values); } finally { isRemoteUpdate = false; }
	}

	function handleOutputUpdate(message: WsOutputsMessage) {
		if (message.sessionId !== getSessionId()) return;
		const allUpdates = processOutputUpdate({ outputs: message.outputs, schema: state.schema });
		if (Object.keys(allUpdates).length > 0) {
			try { isRemoteUpdate = true; Object.assign(state.values, allUpdates); } finally { isRemoteUpdate = false; }
		}
	}

	function handleSchemaUpdated(message: WsSchemaUpdatedMessage) {
		if (message.sessionId !== getSessionId()) return;
		const removedCount = message.removedIds?.length || 0;
		if (removedCount > 0) state.values = removeParametersFromValues(state.values, message.removedIds!);
		state.schema = ensureSchemaLayoutDefaults(message.schema);
		if (removedCount > 0) notification.show(formatParameterUpdateMessage(removedCount));
	}

	function handleMetadataUpdated(message: WsMetadataUpdatedMessage) {
		if (message.sessionId !== getSessionId() || !state.schema) return;
		const changedParams = message.changedParams ?? [];
		if (changedParams.length === 0) return;
		const result = updateParameterMetadata(state.schema, changedParams);
		if (result.updated > 0) notification.show(formatMetadataUpdateMessage(result.names));
	}

	function handleParametersAdded(message: WsSessionMessage) {
		if (message.sessionId !== getSessionId()) return;
		state.syncNeeded = true;
		notification.show('New parameters detected - click Sync to add them to your UI');
	}

	async function initialize() {
		const sessionId = getSessionId();
		if (!sessionId) return;
		if (initialized) return;
		initialized = true;

		initialSolveTriggered = false;
		wsState.on('initialData', handleInitialData);
		wsState.on('currentValues', handleCurrentValues);
		wsState.on('outputs', handleOutputs);
		wsState.on('outputUpdate', handleOutputUpdate);
		wsState.on('schemaUpdated', handleSchemaUpdated);
		wsState.on('metadataUpdated', handleMetadataUpdated);
		wsState.on('parametersAdded', handleParametersAdded);

		const result = await initializeWebSocketSession(sessionId);
		if (result.error) {
			state.error = result.error;
			state.loading = false;
			return;
		}

		wsState.requestInitialData(sessionId);
	}

	function cleanup() {
		if (!initialized) return;
		initialized = false;

		if (solveTimeout) { clearTimeout(solveTimeout); solveTimeout = null; }
		notification.clear();
		wsState.off('initialData', handleInitialData);
		wsState.off('currentValues', handleCurrentValues);
		wsState.off('outputs', handleOutputs);
		wsState.off('outputUpdate', handleOutputUpdate);
		wsState.off('schemaUpdated', handleSchemaUpdated);
		wsState.off('metadataUpdated', handleMetadataUpdated);
		wsState.off('parametersAdded', handleParametersAdded);
	}

	return {
		get state() { return state; },
		get notification() { return getNotification(); },
		wsState,
		handleValueChange,
		handleCalculate,
		syncParameters,
		initialize,
		cleanup
	};
}

