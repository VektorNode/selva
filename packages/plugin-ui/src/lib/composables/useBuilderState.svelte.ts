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
	WsSchemaSaveRejectedMessage,
	WsMetadataUpdatedMessage,
	WsParametersAddedMessage,
	WsSyncPreviewMessage,
	WsSyncAppliedMessage
} from '$lib/websocket/websocket.svelte';
import { useSchemaHistory } from './useSchemaHistory.svelte';

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

function clone(schema: UISchema): UISchema {
	// `$state.snapshot` unwraps any Svelte 5 reactive proxy. structuredClone
	// throws DataCloneError on a raw proxy (e.g. when cloning state.canonical
	// for discardDraft), so the snapshot is required even on the fast path.
	const plain = $state.snapshot(schema) as UISchema;
	return typeof structuredClone === 'function'
		? (structuredClone(plain) as UISchema)
		: (JSON.parse(JSON.stringify(plain)) as UISchema);
}

interface BuilderWebSocketState {
	availableInputs: DiscoveredInput[];
	availableOutputs: DiscoveredOutput[];
	/** Last schema received from the server. Read-only mirror; never edited directly by the UI. */
	canonical: UISchema | null;
	/** Hash of `canonical` as reported by the server. Echoed back on save for conflict detection. */
	canonicalHash: string | null;
	/** The schema the user is editing. Always a deep clone of `canonical` on load. */
	draft: UISchema | null;
	/** Flipped on the first mutation of `draft` in a session. Cleared on save / discard. */
	isDirty: boolean;
	/** documentId of the currently-loaded Grasshopper definition (carried on the schema). */
	documentId: string | null;
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
	const history = useSchemaHistory();

	const state = $state<BuilderWebSocketState>({
		availableInputs: [],
		availableOutputs: [],
		canonical: null,
		canonicalHash: null,
		draft: null,
		isDirty: false,
		documentId: null,
		loading: true,
		error: '',
		syncNeeded: false,
		activeTabId: null,
		syncDialogOpen: false,
		syncDiff: null,
		syncLoading: false,
		outputValues: {}
	});

	/**
	 * Replace `canonical` with a freshly-received schema. If `draft` is clean,
	 * re-clone it from the new canonical so live changes show through. If `draft`
	 * is dirty, leave it alone — the user's edits win until they save (and may
	 * be rejected) or discard. A toast warns about the divergence.
	 */
	function replaceCanonical(schema: UISchema, hash: string | null, reason?: string) {
		state.canonical = schema;
		state.canonicalHash = hash;
		state.documentId = (schema?.documentId as string | undefined) ?? state.documentId;

		if (state.isDirty) {
			toast.warning(reason ?? 'Grasshopper changed while you were editing.');
			return;
		}

		state.draft = clone(schema);
		history.clearHistory();
	}

	/** Mark the draft as dirty on the first mutation in a session. */
	function markDirty() {
		if (!state.isDirty) state.isDirty = true;
	}

	/** Reset the draft to a fresh clone of canonical. Clears dirty. */
	function discardDraft() {
		if (!state.canonical) return;
		state.draft = clone(state.canonical);
		state.isDirty = false;
		history.clearHistory();
	}

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

		// Canonical comes from the server, period. Drafts live only in memory for
		// the lifetime of this tab — see useSchemaHistory for why LS persistence
		// was removed.
		const schema = result.schema;
		if (schema) {
			state.canonical = schema;
			state.canonicalHash = (message.schemaHash as string | undefined) ?? null;
			state.documentId = (schema.documentId as string | undefined) ?? null;

			if (!state.draft || !state.isDirty) {
				state.draft = clone(schema);
				history.clearHistory();
			}
		}

		if (state.availableInputs.length === 0 && state.availableOutputs.length === 0) {
			state.error =
				'No parameters or outputs found. Please ensure the UI Builder component is active in Grasshopper and click Refresh.';
		}

		if (state.draft?.layout?.type === 'tabbed' && state.draft.layout.tabs.length > 0) {
			state.activeTabId = state.draft.layout.tabs[0].id;
		}

		state.loading = false;
	}

	function handleMetadataUpdated(message: WsMetadataUpdatedMessage) {
		if (message.sessionId !== sessionId) return;

		const changedParams = message.changedParams ?? [];
		if (changedParams.length === 0) return;

		// Patch canonical (the server-side mirror) so the next clean re-clone or
		// save-base-hash reflects the metadata. Also patch the draft live — even
		// when dirty — so a Grasshopper-side rename doesn't strand the user with
		// a stale label or block them behind a conflict banner.
		const canonicalResult = state.canonical
			? updateParameterMetadata(state.canonical, changedParams)
			: { updated: 0, names: [] };

		if (state.draft) updateParameterMetadata(state.draft, changedParams);

		// Track names that weren't already captured by the schema helper so we don't double-toast.
		const additionalNames: string[] = [];

		changedParams.forEach((updated) => {
			const inSchema =
				(state.canonical?.inputs.some((inp) => inp.id === updated.id) ?? false) ||
				(state.canonical?.outputs.some((out) => out.id === updated.id) ?? false);

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
					patchDropdownOptions(state.canonical, updated.id, updated.options);
					patchDropdownOptions(state.draft, updated.id, updated.options);
				}
				if (!inSchema && updated.nickname !== undefined) additionalNames.push(updated.nickname);
			}

			const availOutputIndex = state.availableOutputs.findIndex((o) => o.id === updated.id);
			if (availOutputIndex !== -1) {
				if (updated.nickname !== undefined)
					state.availableOutputs[availOutputIndex].nickname = updated.nickname;
				if (updated.description !== undefined)
					state.availableOutputs[availOutputIndex].description = updated.description;
				if (!inSchema && updated.nickname !== undefined) additionalNames.push(updated.nickname);
			}
		});

		// Patching canonical changes its content — its hash is now stale until the
		// server re-broadcasts. Clear the hash so a save attempt before the next
		// schemaUpdated will be safe-rejected rather than racing.
		if (canonicalResult.updated > 0) {
			state.canonicalHash = null;
		}

		// Use canonical's name list only — draft is a sibling clone patched for live
		// render, so its `names` would duplicate canonical's.
		const updatedNames = [...canonicalResult.names, ...additionalNames];
		if (updatedNames.length > 0) {
			toast.info(
				`Parameter${updatedNames.length > 1 ? 's' : ''} renamed in Grasshopper: ${updatedNames.join(', ')}`
			);
		}
	}

	function handleSchemaUpdated(message: WsSchemaUpdatedMessage) {
		if (message.sessionId !== sessionId) return;

		// Detect new IDs *before* replacing canonical so we know whether to refetch
		// availableInputs/Outputs. The plugin auto-merges newly-discovered params
		// into schema.inputs/outputs and broadcasts schemaUpdated (no separate
		// parametersAdded), so the sidebar would otherwise miss them.
		const knownInputIds = new Set(state.availableInputs.map((p) => p.id));
		const knownOutputIds = new Set(state.availableOutputs.map((o) => o.id));
		const hasNewInputs = (message.schema?.inputs ?? []).some((i) => !knownInputIds.has(i.id));
		const hasNewOutputs = (message.schema?.outputs ?? []).some((o) => !knownOutputIds.has(o.id));

		// schemaUpdated is the canonical broadcast — replace wholesale.
		if (message.schema) {
			replaceCanonical(message.schema, message.schemaHash ?? null);
		}

		const removedIds = message.removedIds || [];
		if (removedIds.length > 0) {
			state.availableInputs = state.availableInputs.filter((p) => !removedIds.includes(p.id));
			state.availableOutputs = state.availableOutputs.filter((o) => !removedIds.includes(o.id));

			toast.info(
				`${removedIds.length} item${removedIds.length > 1 ? 's' : ''} removed from Grasshopper`
			);
		}

		// If active tab no longer exists on the new draft, switch to first available.
		if (state.draft?.layout?.type === 'tabbed') {
			if (state.activeTabId && !state.draft.layout.tabs.find((t) => t.id === state.activeTabId)) {
				state.activeTabId =
					state.draft.layout.tabs.length > 0 ? state.draft.layout.tabs[0].id : null;
			}
		}

		// Newly-added params from the canvas: the schema arrived with IDs we have no
		// availableInputs/Outputs entry for. Refetch so the sidebar shows them.
		if (hasNewInputs || hasNewOutputs) {
			wsState.requestInitialData(sessionId);
		}
	}

	function handleSchemaSaveRejected(message: WsSchemaSaveRejectedMessage) {
		if (message.sessionId !== sessionId) return;

		// Server says our base hash is stale. Replace canonical with the server's
		// current schema so the next save attempt uses the fresh hash. The user
		// keeps their dirty draft; the toast tells them what happened.
		state.canonical = message.schema;
		state.canonicalHash = message.schemaHash ?? null;

		toast.error(message.reason ?? 'Grasshopper changed since you started editing.');
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
		if (!state.draft) return;
		// Clear old sync diff data before requesting new preview
		state.syncDiff = null;
		state.syncLoading = true;
		state.syncDialogOpen = true;
		wsState.requestSyncPreview(sessionId, state.draft);
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
		wsState.on('schemaSaveRejected', handleSchemaSaveRejected);
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
		wsState.off('schemaSaveRejected', handleSchemaSaveRejected);
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
		markDirty,
		discardDraft,
		initialize,
		cleanup
	};
}
