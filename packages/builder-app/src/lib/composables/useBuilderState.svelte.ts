import { toast } from '@selva/shared';
import type { UISchema, DiscoveredInput, DiscoveredOutput } from '@selva/shared';
import { processInitialDataSchema, getWebSocketPortFromUrl } from '$lib/utils/session';
import { getWebSocketState } from '$lib/websocket/websocket.svelte';
import type { SyncDiff, SyncChange } from '$lib/websocket/websocket.svelte';

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
}

export function useBuilderState(sessionId: string) {
	// Get WebSocket port from URL to ensure we connect to the correct instance
	const wsPort = getWebSocketPortFromUrl();
	const wsState = getWebSocketState(wsPort);

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
		syncLoading: false
	});

	function handleInitialData(message: any) {
		if (message.sessionId !== sessionId) return;

		const result = processInitialDataSchema(message);

		state.availableInputs = result.availableInputs;
		state.availableOutputs = result.availableOutputs;
		state.schema = result.schema;

		if (state.availableInputs.length === 0 && state.availableOutputs.length === 0) {
			state.error =
				'No parameters or outputs found. Please ensure the UI Builder component is active in Grasshopper and click Refresh.';
		}

		if (state.schema?.layout?.type === 'tabbed' && state.schema.layout.tabs.length > 0) {
			state.activeTabId = state.schema.layout.tabs[0].id;
		}

		state.loading = false;
	}

	function handleSchemaSaved(message: any) {
		if (message.sessionId !== sessionId) return;

		if (message.success) {
			toast.success('Schema saved successfully!');
		} else {
			toast.error(`Failed to save schema: ${message.message || 'Unknown error'}`);
		}
	}

	function handleMetadataUpdated(message: any) {
		if (message.sessionId !== sessionId || !state.schema) return;

		const changedParams = message.changedParams || [];
		if (changedParams.length === 0) return;

		const updatedNames: string[] = [];

		changedParams.forEach((updated: any) => {
			// Update input parameters in schema and available list together
			const inputIndex = state.schema!.inputs.findIndex((inp) => inp.id === updated.id);
			if (inputIndex !== -1) {
				const input = state.schema!.inputs[inputIndex];

				if (updated.nickname !== undefined && input.nickname !== updated.nickname) {
					input.nickname = updated.nickname;
					updatedNames.push(input.nickname);
				}
				if (updated.description !== undefined) {
					input.description = updated.description;
				}

				// Keep availableInputs in sync (same data, different list)
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
				}
			}

			// Update output parameters in schema and available list together
			const outputIndex = state.schema!.outputs.findIndex((out) => out.id === updated.id);
			if (outputIndex !== -1) {
				const output = state.schema!.outputs[outputIndex];

				if (updated.nickname !== undefined && output.nickname !== updated.nickname) {
					output.nickname = updated.nickname;
					updatedNames.push(output.nickname);
				}
				if (updated.description !== undefined) {
					output.description = updated.description;
				}

				// Keep availableOutputs in sync
				const availOutputIndex = state.availableOutputs.findIndex((o) => o.id === updated.id);
				if (availOutputIndex !== -1) {
					if (updated.nickname !== undefined)
						state.availableOutputs[availOutputIndex].nickname = updated.nickname;
					if (updated.description !== undefined)
						state.availableOutputs[availOutputIndex].description = updated.description;
				}
			}
		});

		if (updatedNames.length > 0) {
			toast.info(`Parameter${updatedNames.length > 1 ? 's' : ''} renamed in Grasshopper: ${updatedNames.join(', ')}`);
		}
	}

	function handleSchemaUpdated(message: any) {
		if (message.sessionId !== sessionId) return;

		const removedIds = message.removedIds || [];
		const removedCount = removedIds.length;

		if (removedCount > 0) {
			// Remove from available lists
			state.availableInputs = state.availableInputs.filter((p) => !removedIds.includes(p.id));
			state.availableOutputs = state.availableOutputs.filter((o) => !removedIds.includes(o.id));

			// Remove from schema
			if (state.schema) {
				state.schema.inputs = state.schema.inputs.filter((i) => !removedIds.includes(i.id));
				state.schema.outputs = state.schema.outputs.filter((o) => !removedIds.includes(o.id));

				// Remove from layout items
				if (state.schema.layout) {
					if (state.schema.layout.type === 'tabbed') {
						state.schema.layout.tabs.forEach((tab) => {
							tab.groups.forEach((group) => {
								group.items = group.items.filter((item) => !removedIds.includes(item.paramId));
							});
							tab.groups = tab.groups.filter((g) => g.items.length > 0);
						});

						// Clean up empty tabs
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
							group.items = group.items.filter((item) => !removedIds.includes(item.paramId));
						});
						state.schema.layout.groups = state.schema.layout.groups.filter(
							(g) => g.items.length > 0
						);
					}
				}

				toast.info(
					`${removedCount} item${removedCount > 1 ? 's' : ''} removed from Grasshopper and cleaned from layout`
				);
			}
		} else {
			// New parameters/outputs may have been added
			wsState.requestInitialData(sessionId);
			toast.info('Schema structure updated - checking for new items...');
		}
	}

	function handleParametersAdded(message: any) {
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

	function handleSyncPreview(message: any) {
		if (message.sessionId !== sessionId) return;

		// C# sends fromGH/toGH as camelCase (anonymous object properties)
		// Each SyncChange has PascalCase properties (serialized from C# class)
		state.syncDiff = {
			fromGH: message.fromGH || [],
			toGH: message.toGH || []
		};
		state.syncLoading = false;
	}

	function handleSyncApplied(message: any) {
		if (message.sessionId !== sessionId) return;

		state.syncLoading = false;
		if (message.success) {
			toast.success(message.message || 'Sync completed successfully');
			state.syncDialogOpen = false;
			// Refresh to get updated state
			wsState.requestInitialData(sessionId);
		} else {
			toast.error(message.message || 'Sync failed');
		}
	}

	function requestSyncPreview() {
		if (!state.schema) return;
		state.syncLoading = true;
		state.syncDialogOpen = true;
		wsState.requestSyncPreview(sessionId, state.schema);
	}

	function applySyncChanges(selectedChanges: SyncChange[]) {
		state.syncLoading = true;
		wsState.applySyncChanges(sessionId, selectedChanges);
	}

	function initialize() {
		wsState.on('initialData', handleInitialData);
		wsState.on('schemaSaved', handleSchemaSaved);
		wsState.on('metadataUpdated', handleMetadataUpdated);
		wsState.on('schemaUpdated', handleSchemaUpdated);
		wsState.on('parametersAdded', handleParametersAdded);
		wsState.on('syncPreview', handleSyncPreview);
		wsState.on('syncApplied', handleSyncApplied);

		wsState.requestInitialData(sessionId);
	}

	function cleanup() {
		wsState.off('initialData', handleInitialData);
		wsState.off('schemaSaved', handleSchemaSaved);
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
		syncParameters,
		requestSyncPreview,
		applySyncChanges,
		initialize,
		cleanup
	};
}
