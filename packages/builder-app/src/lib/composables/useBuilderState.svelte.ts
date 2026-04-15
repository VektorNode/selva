import { toast } from 'selva-shared';
import type { UISchema, DiscoveredInput, DiscoveredOutput } from 'selva-shared';
import { processInitialDataSchema, getWebSocketPortFromUrl } from '$lib/utils/session';
import { getWebSocketState } from '$lib/websocket/websocket.svelte';
import type { SyncDiff, SyncChange } from '$lib/websocket/websocket.svelte';
import { useSchemaHistory } from './useSchemaHistory.svelte';

type AnyItem = { type: string; widgetType?: string; paramId?: string; config?: Record<string, unknown> };

function getAllLayoutItems(schema: UISchema): AnyItem[] {
	const items: AnyItem[] = [];
	if (!schema?.layout) return items;
	if (schema.layout.type === 'tabbed') {
		schema.layout.tabs.forEach((tab) => tab.groups?.forEach((g) => items.push(...(g.items as AnyItem[]))));
	} else if (schema.layout.type === 'flat') {
		schema.layout.groups?.forEach((g) => items.push(...(g.items as AnyItem[])));
	}
	return items;
}

/**
 * Backfill empty dropdown options in schema layout items from the available inputs list.
 * Called after initialData so that ValueList options are always populated even when
 * the saved schema has an empty options object (e.g. saved before the VL was wired).
 */
function backfillDropdownOptions(schema: UISchema | null, availableInputs: DiscoveredInput[]): void {
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
function patchDropdownOptions(schema: UISchema | null, paramId: string, options: Record<string, unknown>): void {
	if (!schema) return;
	for (const item of getAllLayoutItems(schema)) {
		if (item.type !== 'input' || item.widgetType !== 'dropdown' || item.paramId !== paramId) continue;
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

	function handleOutputs(message: any) {
		if (message.sessionId !== sessionId) return;
		if (message.outputs) Object.assign(state.outputValues, message.outputs);
	}

	function handleInitialData(message: any) {
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

	function handleSchemaSaved(message: any) {
		// Toast is now handled by the page component's saveSchema() function
		// This handler is kept for backwards compatibility if needed
		if (message.sessionId !== sessionId) return;
	}

	function handleMetadataUpdated(message: any) {
		if (message.sessionId !== sessionId) return;

		const changedParams = [
			...(message.changedParams?.inputs || []),
			...(message.changedParams?.outputs || [])
		];
		if (changedParams.length === 0) return;

		const updatedNames: string[] = [];

		changedParams.forEach((updated: any) => {
			// Update schema inputs if present
			let inputInSchema = false;
			if (state.schema) {
				const inputIndex = state.schema.inputs.findIndex((inp) => inp.id === updated.id);
				if (inputIndex !== -1) {
					inputInSchema = true;
					const input = state.schema.inputs[inputIndex];
					if (updated.nickname !== undefined && input.nickname !== updated.nickname) {
						input.nickname = updated.nickname;
						updatedNames.push(updated.nickname);
					}
					if (updated.description !== undefined) input.description = updated.description;
				}
			}

			// Always update availableInputs regardless of schema membership
			const availIndex = state.availableInputs.findIndex((p) => p.id === updated.id);
			if (availIndex !== -1) {
				if (updated.nickname !== undefined) state.availableInputs[availIndex].nickname = updated.nickname;
				if (updated.description !== undefined) state.availableInputs[availIndex].description = updated.description;
				if (updated.minimum !== undefined) state.availableInputs[availIndex].minimum = updated.minimum;
				if (updated.maximum !== undefined) state.availableInputs[availIndex].maximum = updated.maximum;
				if (updated.stepSize !== undefined) state.availableInputs[availIndex].stepSize = updated.stepSize;
				if (updated.options !== undefined) {
					state.availableInputs[availIndex].options = updated.options;
					patchDropdownOptions(state.schema, updated.id, updated.options);
				}
				// Toast if not already toasted via schema path
				if (!inputInSchema && updated.nickname !== undefined) updatedNames.push(updated.nickname);
			}

			// Update schema outputs if present
			let outputInSchema = false;
			if (state.schema) {
				const outputIndex = state.schema.outputs.findIndex((out) => out.id === updated.id);
				if (outputIndex !== -1) {
					outputInSchema = true;
					const output = state.schema.outputs[outputIndex];
					if (updated.nickname !== undefined && output.nickname !== updated.nickname) {
						output.nickname = updated.nickname;
						updatedNames.push(updated.nickname);
					}
					if (updated.description !== undefined) output.description = updated.description;
				}
			}

			// Always update availableOutputs regardless of schema membership
			const availOutputIndex = state.availableOutputs.findIndex((o) => o.id === updated.id);
			if (availOutputIndex !== -1) {
				if (updated.nickname !== undefined) state.availableOutputs[availOutputIndex].nickname = updated.nickname;
				if (updated.description !== undefined) state.availableOutputs[availOutputIndex].description = updated.description;
				if (!outputInSchema && updated.nickname !== undefined) updatedNames.push(updated.nickname);
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
								group.items = group.items.filter((item) => item.type === 'linebreak' || !removedIds.includes(item.paramId));
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
							group.items = group.items.filter((item) => item.type === 'linebreak' || !removedIds.includes(item.paramId));
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

	function initialize() {
		wsState.on('outputs', handleOutputs);
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
		wsState.off('outputs', handleOutputs);
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
		history,
		syncParameters,
		requestSyncPreview,
		applySyncChanges,
		initialize,
		cleanup
	};
}
