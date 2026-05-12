import { toast } from '@selvajs/ui';
import type { UISchema, DiscoveredInput, DiscoveredOutput } from '@selvajs/schemas';
import { processInitialDataSchema, getWebSocketPortFromUrl } from '$lib/utils/session';
import { getWebSocketState } from '$lib/websocket/websocket.svelte';
import { getAllLayoutItems } from '$lib/features/builder/operations';
import { updateParameterMetadata } from '$lib/features/preview/handlers';
import type {
	SyncDiff,
	SyncChange,
	WsInitialDataMessage,
	WsOutputsMessage,
	WsSchemaUpdatedMessage,
	WsMetadataUpdatedMessage,
	WsParametersAddedMessage,
	WsSyncPreviewMessage,
	WsSyncAppliedMessage
} from '$lib/websocket/websocket.svelte';
import { useSchemaHistory } from './useSchemaHistory.svelte';


/**
 * Backfill empty dropdown options in schema layout items from the available inputs list.
 * Called after initialData so that ValueList options are always populated even when
 * the saved schema has an empty options object (e.g. saved before the VL was wired).
 */
function backfillDropdownOptions(
	schema: UISchema | null,
	availableInputs: DiscoveredInput[]
): void {
	if (!schema) return;
	const optionsByParamId = new Map(availableInputs.map((p) => [p.id, p.options]));
	for (const item of getAllLayoutItems(schema)) {
		if (item.type !== 'input' || item.widgetType !== 'dropdown' || !item.paramId) continue;
		const existingOptions = item.config?.options as Record<string, unknown> | undefined;
		if (existingOptions && Object.keys(existingOptions).length > 0) continue;
		const options = optionsByParamId.get(item.paramId);
		if (options && Object.keys(options).length > 0) {
			item.config = { ...item.config, options };
		}
	}
}

/**
 * Patch dropdown layout item configs in the schema when options change at runtime.
 */
function patchDropdownOptions(
	schema: UISchema | null,
	paramId: string,
	options: { [k: string]: string | undefined }
): void {
	if (!schema) return;
	for (const item of getAllLayoutItems(schema)) {
		if (item.type !== 'input' || item.widgetType !== 'dropdown' || item.paramId !== paramId)
			continue;
		item.config = { ...item.config, options };
	}
}

interface BuilderWebSocketState {
	availableInputs: DiscoveredInput[];
	availableOutputs: DiscoveredOutput[];
	schema: UISchema | null;
	loading: boolean;
	error: string;
	syncNeeded: boolean;
	activeTabId: string | null;
	syncDialogOpen: boolean;
	syncDiff: SyncDiff | null;
	syncLoading: boolean;
	outputValues: Record<string, unknown>;
}

export function useBuilderState(sessionId: string) {
	// Get WebSocket port from URL to ensure we connect to the correct instance
	const wsPort = getWebSocketPortFromUrl();
	const wsState = getWebSocketState(wsPort);
	const history = useSchemaHistory(sessionId);

	const state = $state<BuilderWebSocketState>({
		availableInputs: [],
		availableOutputs: [],
		schema: null,
		loading: true,
		error: '',
		syncNeeded: false,
		activeTabId: null,
		syncDialogOpen: false,
		syncDiff: null,
		syncLoading: false,
		outputValues: {}
	});

	function handleOutputs(message: WsOutputsMessage) {
		if (message.sessionId !== sessionId) return;
		if (message.outputs) Object.assign(state.outputValues, message.outputs);
	}

	function handleInitialData(message: WsInitialDataMessage) {
		if (message.sessionId !== sessionId) return;

		if (message.outputs) Object.assign(state.outputValues, message.outputs);

		const result = processInitialDataSchema(message);

		state.availableInputs = result.availableInputs;
		state.availableOutputs = result.availableOutputs;

		// Check if there's a saved schema in localStorage that's newer
		const savedSchema = history.loadCurrentSchema();
		if (savedSchema) {
			state.schema = savedSchema;
			// Restore history stacks from localStorage
			history.restoreFromStorage();
		} else {
			state.schema = result.schema;
		}

		// Backfill any dropdown layout items whose options are empty (e.g. schema saved before VL was wired)
		backfillDropdownOptions(state.schema, state.availableInputs);

		if (state.availableInputs.length === 0 && state.availableOutputs.length === 0) {
			state.error =
				'No parameters or outputs found. Please ensure the UI Builder component is active in Grasshopper and click Refresh.';
		}

		if (state.schema?.layout?.type === 'tabbed' && state.schema.layout.tabs.length > 0) {
			state.activeTabId = state.schema.layout.tabs[0].id;
		}

		state.loading = false;
	}

	function handleMetadataUpdated(message: WsMetadataUpdatedMessage) {
		if (message.sessionId !== sessionId) return;

		const changedParams = message.changedParams ?? [];
		if (changedParams.length === 0) return;

		// Patch the schema itself (inputs, outputs, and layout-item configs) via the shared helper.
		// This is the part that was missing for slider range edits: NumberWidgetConfig.minimum/maximum
		// /stepSize on the live UI schema now stays in sync with the GH slider.
		const schemaResult = state.schema
			? updateParameterMetadata(state.schema, changedParams)
			: { updated: 0, names: [] };

		// Track names that weren't already captured by the schema helper so we don't double-toast.
		const additionalNames: string[] = [];

		changedParams.forEach((updated) => {
			const inputInSchema = state.schema?.inputs.some((inp) => inp.id === updated.id) ?? false;
			const outputInSchema = state.schema?.outputs.some((out) => out.id === updated.id) ?? false;

			const availIndex = state.availableInputs.findIndex((p) => p.id === updated.id);
			if (availIndex !== -1) {
				if (updated.nickname !== undefined)
					state.availableInputs[availIndex].nickname = updated.nickname;
				if (updated.description !== undefined)
					state.availableInputs[availIndex].description = updated.description;
				if (updated.minimum !== undefined)
					state.availableInputs[availIndex].minimum = updated.minimum;
				if (updated.maximum !== undefined)
					state.availableInputs[availIndex].maximum = updated.maximum;
				if (updated.stepSize !== undefined)
					state.availableInputs[availIndex].stepSize = updated.stepSize;
				if (updated.options !== undefined) {
					state.availableInputs[availIndex].options = updated.options;
					// Belt-and-suspenders: the shared helper patches dropdown options on layout items,
					// but only for items whose paramId matches. Keep this call so dropdowns added via
					// non-standard widgetTypes still get options refreshed at the availableInputs level.
					patchDropdownOptions(state.schema, updated.id, updated.options);
				}
				if (!inputInSchema && updated.nickname !== undefined)
					additionalNames.push(updated.nickname);
			}

			const availOutputIndex = state.availableOutputs.findIndex((o) => o.id === updated.id);
			if (availOutputIndex !== -1) {
				if (updated.nickname !== undefined)
					state.availableOutputs[availOutputIndex].nickname = updated.nickname;
				if (updated.description !== undefined)
					state.availableOutputs[availOutputIndex].description = updated.description;
				if (!outputInSchema && updated.nickname !== undefined)
					additionalNames.push(updated.nickname);
			}
		});

		// Persist the freshly-patched schema to localStorage explicitly. Without this, navigating
		// builder → preview would auto-save the *stale pre-patch* schema back to the server
		// (the navigation guard pushes localStorage state, and the $effect that mirrors state.schema
		// to localStorage can lag behind deep mutations made inside updateParameterMetadata).
		if (state.schema && schemaResult.updated > 0) {
			history.persistCurrentSchema(state.schema);
		}

		const updatedNames = [...schemaResult.names, ...additionalNames];
		if (updatedNames.length > 0) {
			toast.info(
				`Parameter${updatedNames.length > 1 ? 's' : ''} renamed in Grasshopper: ${updatedNames.join(', ')}`
			);
		}
	}

	function handleSchemaUpdated(message: WsSchemaUpdatedMessage) {
		if (message.sessionId !== sessionId) return;

		const removedIds = message.removedIds || [];
		const removedCount = removedIds.length;

		if (removedCount > 0) {
			state.availableInputs = state.availableInputs.filter((p) => !removedIds.includes(p.id));
			state.availableOutputs = state.availableOutputs.filter((o) => !removedIds.includes(o.id));

			if (state.schema) {
				state.schema.inputs = state.schema.inputs.filter((i) => !removedIds.includes(i.id));
				state.schema.outputs = state.schema.outputs.filter((o) => !removedIds.includes(o.id));

				if (state.schema.layout) {
					if (state.schema.layout.type === 'tabbed') {
						state.schema.layout.tabs.forEach((tab) => {
							tab.groups.forEach((group) => {
								group.items = group.items.filter(
									(item) => item.type === 'linebreak' || !removedIds.includes(item.paramId)
								);
							});
							tab.groups = tab.groups.filter((g) => g.items.length > 0);
						});

						state.schema.layout.tabs = state.schema.layout.tabs.filter((t) => t.groups.length > 0);

						// If active tab was removed, switch to first available
						if (
							state.activeTabId &&
							!state.schema.layout.tabs.find((t) => t.id === state.activeTabId)
						) {
							state.activeTabId =
								state.schema.layout.tabs.length > 0 ? state.schema.layout.tabs[0].id : null;
						}
					} else if (state.schema.layout.type === 'flat') {
						state.schema.layout.groups.forEach((group) => {
							group.items = group.items.filter(
								(item) => item.type === 'linebreak' || !removedIds.includes(item.paramId)
							);
						});
						state.schema.layout.groups = state.schema.layout.groups.filter(
							(g) => g.items.length > 0
						);
					}
				}
			}

			toast.info(
				`${removedCount} item${removedCount > 1 ? 's' : ''} removed from Grasshopper and cleaned from layout`
			);
		} else {
			wsState.requestInitialData(sessionId);
			toast.info('Schema structure updated - checking for new items...');
		}
	}

	function handleParametersAdded(message: WsParametersAddedMessage) {
		if (message.sessionId !== sessionId) return;

		const availableParams = message.availableParams;

		let updated = false;

		if (availableParams?.inputs && Array.isArray(availableParams.inputs)) {
			state.availableInputs = availableParams.inputs;
			updated = true;
		}

		if (availableParams?.outputs && Array.isArray(availableParams.outputs)) {
			state.availableOutputs = availableParams.outputs;
			updated = true;
		}

		if (updated) {
			state.syncNeeded = true;
			toast.info('New items detected - click Sync to add them to your schema');
		} else {
			wsState.requestInitialData(sessionId);
			toast.info('New items detected - refreshing...');
		}
	}

	function syncParameters() {
		state.syncNeeded = false;
		wsState.requestInitialData(sessionId);
		toast.info('Syncing parameters...');
	}

	function handleSyncPreview(message: WsSyncPreviewMessage) {
		if (message.sessionId !== sessionId) return;

		// C# sends fromGH/toGH as camelCase (anonymous object properties)
		// Each SyncChange has PascalCase properties (serialized from C# class)
		state.syncDiff = {
			fromGH: message.fromGH || [],
			toGH: message.toGH || []
		};
		state.syncLoading = false;
	}

	function handleSyncApplied(message: WsSyncAppliedMessage) {
		if (message.sessionId !== sessionId) return;

		state.syncLoading = false;
		if (message.success) {
			toast.success(message.message || 'Sync completed successfully');
			state.syncDialogOpen = false;
			// Clear old sync diff data
			state.syncDiff = null;
			// Refresh to get updated state
			wsState.requestInitialData(sessionId);
		} else {
			toast.error(message.message || 'Sync failed');
		}
	}

	function requestSyncPreview() {
		if (!state.schema) return;
		// Clear old sync diff data before requesting new preview
		state.syncDiff = null;
		state.syncLoading = true;
		state.syncDialogOpen = true;
		wsState.requestSyncPreview(sessionId, state.schema);
	}

	function applySyncChanges(selectedChanges: SyncChange[]) {
		state.syncLoading = true;
		wsState.applySyncChanges(sessionId, selectedChanges);
	}

	let initialized = false;

	function initialize() {
		if (initialized) return;
		initialized = true;

		wsState.on('outputs', handleOutputs);
		wsState.on('initialData', handleInitialData);
		wsState.on('metadataUpdated', handleMetadataUpdated);
		wsState.on('schemaUpdated', handleSchemaUpdated);
		wsState.on('parametersAdded', handleParametersAdded);
		wsState.on('syncPreview', handleSyncPreview);
		wsState.on('syncApplied', handleSyncApplied);

		wsState.requestInitialData(sessionId);
	}

	function cleanup() {
		if (!initialized) return;
		initialized = false;

		wsState.off('outputs', handleOutputs);
		wsState.off('initialData', handleInitialData);
		wsState.off('metadataUpdated', handleMetadataUpdated);
		wsState.off('schemaUpdated', handleSchemaUpdated);
		wsState.off('parametersAdded', handleParametersAdded);
		wsState.off('syncPreview', handleSyncPreview);
		wsState.off('syncApplied', handleSyncApplied);
	}

	return {
		get state() {
			return state;
		},
		wsState,
		history,
		syncParameters,
		requestSyncPreview,
		applySyncChanges,
		initialize,
		cleanup
	};
}
